import base64
import json
import os
import subprocess
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


def _probe_audio(filepath: str) -> tuple[int | None, int | None]:
    """Return (sample_rate_hz, channel_count) from the ffprobe audio stream."""
    probe = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            filepath,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    streams = json.loads(probe.stdout).get("streams", [])
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if audio_stream is None:
        raise ValueError("No audio stream found in uploaded file")

    sample_rate_hz = None
    channel_count = None

    sample_rate_raw = audio_stream.get("sample_rate")
    channels_raw = audio_stream.get("channels")

    if sample_rate_raw is not None:
        parsed_sample_rate = int(sample_rate_raw)
        if parsed_sample_rate > 0:
            sample_rate_hz = parsed_sample_rate
    if channels_raw is not None:
        parsed_channels = int(channels_raw)
        if parsed_channels > 0:
            channel_count = parsed_channels

    return sample_rate_hz, channel_count


def transcribe_audio(bucket_name: str, object_name: str, gcs_uri: str) -> str:
    client = speech.SpeechClient()
    storage_client = storage.Client()
    blob = storage_client.bucket(bucket_name).blob(object_name)
    with tempfile.NamedTemporaryFile(delete=True) as temp_file:
        blob.download_to_filename(temp_file.name)
        temp_file.flush()
        with open(temp_file.name, "rb") as audio_file:
            header = audio_file.read(16)
        audio = speech.RecognitionAudio(uri=gcs_uri)
        # Match Speech-to-Text settings to the actual uploaded file contents,
        # not just the filename extension.
        if header.startswith(b"RIFF"):
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
        elif header.startswith(b"ID3") or header[:1] == b"\xff":
            sample_rate_hz, channel_count = _probe_audio(temp_file.name)
            config_kwargs = {
                "encoding": speech.RecognitionConfig.AudioEncoding.MP3,
                "language_code": "en-US",
                "enable_automatic_punctuation": True,
            }
            if sample_rate_hz is not None:
                config_kwargs["sample_rate_hertz"] = sample_rate_hz
            if channel_count is not None:
                config_kwargs["audio_channel_count"] = channel_count
                config_kwargs["enable_separate_recognition_per_channel"] = channel_count > 1

            config = speech.RecognitionConfig(
                **config_kwargs,
            )
        elif header.startswith(b"\x1aE\xdf\xa3"):
            # WebM/Opus can be transcribed directly from Cloud Storage.
            # Keep the request GCS-backed so long recordings do not hit the inline payload limit.
            audio = speech.RecognitionAudio(uri=gcs_uri)
            config = speech.RecognitionConfig(
                encoding=speech.RecognitionConfig.AudioEncoding.WEBM_OPUS,
                language_code="en-US",
                enable_automatic_punctuation=True,
            )
        else:
            raise ValueError(f"Unsupported or unrecognized audio format: {object_name}")
    operation = client.long_running_recognize(config=config, audio=audio)
    response = operation.result(timeout=300)
    return " ".join(result.alternatives[0].transcript for result in response.results)