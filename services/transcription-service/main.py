import base64
import json
import os
import tempfile
import wave
from urllib import response
from flask import Flask, request
from google.cloud import speech, storage, pubsub_v1, firestore

app = Flask(__name__)

db = firestore.Client()
publisher = pubsub_v1.PublisherClient()
TRANSCRIPTION_TOPIC = f"projects/{os.environ['PROJECT_ID']}/topics/transcript-ready"

@app.route("/", methods=["POST"])
def handle_gcs_event():
    event_data = request.get_json(silent=True) or {}

    bucket_name = event_data.get("bucket")
    object_name = event_data.get("name")

    if not bucket_name or not object_name:
        app.logger.warning("Invalid Eventarc payload: missing bucket or name")
        return ("Invalid event payload", 400)

    # Expected object path shape includes session id as the second segment.
    object_parts = object_name.split("/")
    if len(object_parts) < 2 or not object_parts[1]:
        app.logger.warning("Skipping object with unexpected path format: %s", object_name)
        return ("Ignored object path format", 200)

    session_id = object_parts[1]
    session_ref = db.collection("sessions").document(session_id)
    session = session_ref.get()

    if session.exists and session.get("status") not in ("uploaded", "pending"):
        return "Session already processed", 200
    
    #Update Firestore
    session_ref.set({"status": "transcribing"}, merge=True)

    #Transcribe audio
    gcs_uri = f"gs://{bucket_name}/{object_name}"
    transcript_text = transcribe_audio(bucket_name, object_name, gcs_uri)

    message = json.dumps({
        "sessionId": session_id,
        "transcript": transcript_text,
        "gcsObject": object_name
    }).encode("utf-8")

    publisher.publish(TRANSCRIPTION_TOPIC, message, sessionId=session_id)

    session_ref.set({"status": "transcribed", "transcript": transcript_text}, merge=True)

    return ("Transcription completed", 200)

def transcribe_audio(bucket_name: str, object_name: str, gcs_uri: str) -> str:
    client = speech.SpeechClient()
    audio = speech.RecognitionAudio(uri=gcs_uri)

    # Match Speech-to-Text settings to the uploaded file format.
    if object_name.lower().endswith(".wav"):
        storage_client = storage.Client()
        blob = storage_client.bucket(bucket_name).blob(object_name)

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as temp_file:
            blob.download_to_filename(temp_file.name)
            temp_file.flush()

            with wave.open(temp_file.name, "rb") as wav_file:
                channel_count = wav_file.getnchannels()
                sample_rate_hz = wav_file.getframerate()

        config = speech.RecognitionConfig(
            encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
            language_code="en-US",
            enable_automatic_punctuation=True,
            sample_rate_hertz=sample_rate_hz,
            audio_channel_count=channel_count,
            enable_separate_recognition_per_channel=channel_count > 1,
        )
    else:
        config = speech.RecognitionConfig(
            encoding=speech.RecognitionConfig.AudioEncoding.WEBM_OPUS,
            language_code="en-US",
            enable_automatic_punctuation=True,
        )
    operation = client.long_running_recognize(config=config, audio=audio)
    response = operation.result(timeout=300)

    return " ".join(result.alternatives[0].transcript for result in response.results)