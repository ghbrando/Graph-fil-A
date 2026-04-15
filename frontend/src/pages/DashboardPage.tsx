import { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { motion } from "motion/react";
import {
  Mic,
  LayoutGrid,
  FileText,
  BarChart3,
  RotateCcw,
  Play,
  Pause,
  Loader,
} from "lucide-react";
import { auth } from "../lib/firebase";

interface DashboardPageProps {
  onSignOut: () => void;
}

export function DashboardPage({ onSignOut }: DashboardPageProps) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<
    "graph" | "transcript" | "summary"
  >("graph");
  const [isRecording, setIsRecording] = useState(false);
  const [hasRecorded, setHasRecorded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Refs for recording
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const allChunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const durationResolvedRef = useRef(false);

  // Load audio metadata when URL changes
  useEffect(() => {
    if (audioUrl && audioRef.current) {
      durationResolvedRef.current = false;
      audioRef.current.src = audioUrl;
      audioRef.current.load();
      setPlaybackProgress(0);
      setIsPlaying(false);
      setAudioDuration(0);
    }
  }, [audioUrl]);

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const recorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      recorder.ondataavailable = (event) => {
        allChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(allChunksRef.current, { type: "audio/webm" });
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        const newUrl = URL.createObjectURL(blob);
        setAudioUrl(newUrl);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      setIsRecording(true);
    } catch (err) {
      console.error("Mic access denied or unavailable:", err);
    }
  };

  const handleStopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    setHasRecorded(true);
  };

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const elapsedSeconds = (playbackProgress / 100) * audioDuration;
  const currentTime = formatTime(elapsedSeconds);
  const totalTime = formatTime(audioDuration);

  const handleGenerateGraph = async () => {
    if (!audioUrl || !allChunksRef.current.length) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const { getIdToken } = await import("firebase/auth");
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("No authenticated user found");
      const token = await getIdToken(auth.currentUser!);
      const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      // Get signed URL
      const res = await fetch(
        `${import.meta.env.VITE_API_GATEWAY_URL}/sessions/upload-url`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sessionId, uid }),
        },
      );
      if (!res.ok) throw new Error("Failed to get upload URL");
      const { url } = await res.json();

      // Build blob from allChunksRef
      const blob = new Blob(allChunksRef.current, { type: "audio/webm" });

      // PUT to GCS
      const upload = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "audio/webm",
        },
        body: blob,
      });
      if (!upload.ok) throw new Error("Upload failed");

      // TODO: navigate to graph view or show success
      console.log("Audio uploaded successfully. Session ID:", sessionId);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <>
      {/* Hidden audio element for real playback */}
      <audio
        ref={audioRef}
        src={audioUrl ?? undefined}
        crossOrigin="anonymous"
        onLoadedMetadata={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            durationResolvedRef.current = true;
            setAudioDuration(audio.duration);
          } else {
            // Chromium MediaRecorder WebM blobs report Infinity for duration.
            // Seeking past the end forces the browser to compute the real duration.
            audio.currentTime = 1e101;
          }
        }}
        onDurationChange={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (
            Number.isFinite(audio.duration) &&
            audio.duration > 0 &&
            !durationResolvedRef.current
          ) {
            durationResolvedRef.current = true;
            setAudioDuration(audio.duration);
            audio.currentTime = 0;
          }
        }}
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (!durationResolvedRef.current) return;
          if (!Number.isFinite(audio.duration) || audio.duration === 0) return;
          setPlaybackProgress((audio.currentTime / audio.duration) * 100);
        }}
        onEnded={() => {
          setIsPlaying(false);
          setPlaybackProgress(0);
        }}
        onError={() => {
          console.error("Audio error:", audioRef.current?.error);
        }}
      />
      <div className="w-screen h-screen bg-[#0d0d0d] flex relative overflow-hidden">
        {/* Dot grid background */}
        <div
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle, #2a2a2a 0.5px, transparent 0.5px)",
            backgroundSize: "28px 28px",
          }}
        />

        {/* Gradient orb */}
        <motion.div
          className="absolute w-[600px] h-[600px] rounded-full blur-[120px] opacity-20 pointer-events-none"
          style={{
            background: "radial-gradient(circle, #e8317a 0%, transparent 70%)",
          }}
          animate={{
            x: [0, 50, -50, 0],
            y: [0, -50, 50, 0],
            scale: [1, 1.1, 0.9, 1],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />

        {/* Undo Button */}
        {hasRecorded && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            onClick={() => {
              // Stop recording if active
              mediaRecorderRef.current?.stop();
              mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
              mediaStreamRef.current = null;
              mediaRecorderRef.current = null;
              allChunksRef.current = [];
              // Revoke object URL
              if (audioUrl) URL.revokeObjectURL(audioUrl);
              // Reset state
              setHasRecorded(false);
              setIsRecording(false);
              setIsPlaying(false);
              setPlaybackProgress(0);
              setAudioUrl(null);
              setAudioDuration(0);
              setUploadError(null);
            }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className="absolute top-6 left-[236px] z-20 p-2.5 bg-[#161616] border border-[#2a2a2a] text-[#888888] rounded-lg hover:border-[#e8317a] hover:text-[#f0f0f0] transition-colors"
            title="Undo last recording"
          >
            <RotateCcw size={20} />
          </motion.button>
        )}

        {/* Sidebar */}
        <div className="w-[220px] h-full bg-[#111111] border-r border-[#2a2a2a] flex flex-col relative z-10">
          {/* Logo */}
          <div className="px-4 py-5 border-b border-[#2a2a2a]">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-[7px] h-[7px] rounded-full bg-[#e8317a]" />
              <h1 className="text-[17px] font-medium text-[#f0f0f0]">
                Graph-fil-A
              </h1>
            </div>
            <p className="text-[11px] text-[#888888]">
              Voice → Knowledge Graph
            </p>
          </div>

          {/* Navigation Tabs */}
          <div className="flex-1 px-4 py-4">
            <h2 className="text-[10px] uppercase text-[#888888] tracking-[1.2px] mb-3">
              Workspace
            </h2>
            <nav className="space-y-1">
              {/* Graph Tab */}
              <button
                onClick={() => setActiveTab("graph")}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[13px] border-l-2 -ml-4 pl-[14px] transition-colors ${
                  activeTab === "graph"
                    ? "text-[#f0f0f0] border-[#e8317a]"
                    : "text-[#888888] hover:text-[#f0f0f0] border-transparent"
                }`}
              >
                <LayoutGrid size={14} />
                <span>Graph</span>
              </button>

              {/* Transcription Tab */}
              <button
                onClick={() => setActiveTab("transcript")}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[13px] border-l-2 -ml-4 pl-[14px] transition-colors ${
                  activeTab === "transcript"
                    ? "text-[#f0f0f0] border-[#e8317a]"
                    : "text-[#888888] hover:text-[#f0f0f0] border-transparent"
                }`}
              >
                <FileText size={14} />
                <span>Transcription</span>
              </button>

              {/* Summary Tab */}
              <button
                onClick={() => setActiveTab("summary")}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-[13px] border-l-2 -ml-4 pl-[14px] transition-colors ${
                  activeTab === "summary"
                    ? "text-[#f0f0f0] border-[#e8317a]"
                    : "text-[#888888] hover:text-[#f0f0f0] border-transparent"
                }`}
              >
                <BarChart3 size={14} />
                <span>Summary</span>
              </button>
            </nav>
          </div>

          {/* User Profile Section */}
          <div className="px-4 py-3 border-t border-[#2a2a2a]">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-[30px] h-[30px] rounded-full bg-gradient-to-br from-[#e8317a] to-[#8b5cf6] flex items-center justify-center text-white text-[11px] font-medium">
                {user?.email?.substring(0, 2).toUpperCase() || "U"}
              </div>
              <div>
                <p className="text-[12px] font-medium text-[#f0f0f0]">
                  {user?.email?.split("@")[0] || "User"}
                </p>
                <p className="text-[10px] text-[#888888]">Free plan</p>
              </div>
            </div>
            <button
              onClick={onSignOut}
              className="w-full bg-[#161616] border border-[#2a2a2a] text-[#aaaaaa] px-3 py-1.5 rounded-lg text-[11px] font-medium hover:border-[#e8317a] hover:text-[#f0f0f0] transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex items-center justify-center relative z-5">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center justify-center gap-3"
          >
            {/* Recording Container */}
            <div className="relative w-[160px] h-[160px] flex items-center justify-center">
              {/* Pulsing rings during recording */}
              {isRecording && (
                <>
                  <motion.div
                    animate={{
                      scale: [1, 1.3, 1.6],
                      opacity: [1, 0.5, 0],
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "easeOut",
                    }}
                    className="absolute w-full h-full rounded-full border-2 border-[#e8317a]"
                  />
                  <motion.div
                    animate={{
                      scale: [1, 1.3, 1.6],
                      opacity: [1, 0.5, 0],
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "easeOut",
                      delay: 0.3,
                    }}
                    className="absolute w-full h-full rounded-full border-2 border-[#e8317a]"
                  />
                </>
              )}

              {/* Record/Stop Button */}
              <motion.button
                onClick={() => {
                  if (isRecording) {
                    handleStopRecording();
                  } else {
                    handleStartRecording();
                  }
                }}
                whileHover={{ scale: isRecording ? 1 : 1.05 }}
                whileTap={{ scale: 0.95 }}
                animate={isRecording ? { scale: [1, 1.02, 1] } : {}}
                transition={
                  isRecording ? { duration: 0.6, repeat: Infinity } : {}
                }
                className={`w-[120px] h-[120px] rounded-full flex items-center justify-center shadow-lg transition-all relative z-10 ${
                  isRecording
                    ? "bg-gradient-to-br from-[#ef4444] to-[#dc2626]"
                    : "bg-gradient-to-br from-[#e8317a] to-[#d02a6e] hover:from-[#d02a6e] hover:to-[#b82359]"
                }`}
              >
                {isRecording ? (
                  <motion.div className="w-[48px] h-[48px] bg-white rounded" />
                ) : (
                  <Mic size={56} className="text-white" />
                )}
              </motion.button>
            </div>

            {/* Text/Status Below Button */}
            <div className="text-center">
              {isRecording ? (
                <>
                  <div className="flex items-center justify-center gap-2 mb-2">
                    <motion.div
                      animate={{ opacity: [1, 0.5, 1] }}
                      transition={{ duration: 1, repeat: Infinity }}
                      className="w-[8px] h-[8px] rounded-full bg-[#ef4444]"
                    />
                    <h2 className="text-[24px] font-medium text-[#f0f0f0]">
                      Recording...
                    </h2>
                  </div>
                  <p className="text-[13px] text-[#888888]">
                    Click the square to stop
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-[24px] font-medium text-[#f0f0f0] mb-2">
                    {hasRecorded ? "Resume Recording" : "Start Recording"}
                  </h2>
                  <p className="text-[13px] text-[#888888]">
                    {hasRecorded
                      ? "Click the microphone to continue"
                      : "Click the microphone to begin"}
                  </p>
                </>
              )}

              {/* Playback Bar */}
              {hasRecorded && !isRecording && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="mt-6 w-[500px] flex items-center gap-4"
                >
                  {/* Play/Pause Button */}
                  <motion.button
                    onClick={() => {
                      const audio = audioRef.current;
                      if (!audio) return;
                      if (isPlaying) {
                        audio.pause();
                        setIsPlaying(false);
                      } else {
                        audio.play();
                        setIsPlaying(true);
                      }
                    }}
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    className="flex-shrink-0 w-[44px] h-[44px] rounded-full bg-[#161616] border border-[#2a2a2a] text-[#e8317a] flex items-center justify-center hover:border-[#e8317a] transition-colors"
                  >
                    {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                  </motion.button>

                  {/* Progress Bar */}
                  <div className="flex-1 flex flex-col gap-1">
                    <div
                      className="h-2.5 bg-[#2a2a2a] rounded-full cursor-pointer overflow-hidden"
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const percent =
                          ((e.clientX - rect.left) / rect.width) * 100;
                        const clamped = Math.max(0, Math.min(100, percent));
                        setPlaybackProgress(clamped);
                        if (audioRef.current) {
                          audioRef.current.currentTime =
                            (clamped / 100) * (audioRef.current.duration || 0);
                        }
                      }}
                    >
                      <div
                        className="h-full bg-[#e8317a] rounded-full transition-all"
                        style={{ width: `${playbackProgress}%` }}
                      />
                    </div>
                  </div>

                  {/* Duration Text */}
                  <div className="flex-shrink-0 text-[13px] text-[#888888] whitespace-nowrap">
                    {currentTime} / {totalTime}
                  </div>
                </motion.div>
              )}

              {/* Generate Graph Button */}
              {hasRecorded && !isRecording && (
                <div className="flex flex-col items-center gap-3">
                  <motion.button
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    whileHover={{ scale: isUploading ? 1 : 1.05 }}
                    whileTap={{ scale: isUploading ? 1 : 0.95 }}
                    onClick={handleGenerateGraph}
                    disabled={isUploading}
                    className={`mt-8 px-8 py-3.5 rounded-lg text-[16px] font-medium transition-all shadow-lg flex items-center gap-2 ${
                      isUploading
                        ? "bg-[#444444] text-[#888888] cursor-not-allowed"
                        : "bg-gradient-to-r from-[#e8317a] to-[#d02a6e] text-white hover:from-[#d02a6e] hover:to-[#b82359]"
                    }`}
                  >
                    {isUploading && (
                      <Loader size={16} className="animate-spin" />
                    )}
                    {isUploading ? "Uploading..." : "Generate Graph"}
                  </motion.button>
                  {uploadError && (
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-[13px] text-[#ef4444]"
                    >
                      {uploadError}
                    </motion.p>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </>
  );
}
