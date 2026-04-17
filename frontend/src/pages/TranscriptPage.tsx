import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Loader, Copy, Check } from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";

interface TranscriptPageProps {
  sessionId: string;
}

export function TranscriptPage({ sessionId }: TranscriptPageProps) {
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = onSnapshot(
      doc(db, "sessions", sessionId),
      (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        if (data.transcript) {
          setTranscript(data.transcript as string);
        }
        setLoading(false);
      },
      (err) => {
        console.error("Transcript fetch error:", err);
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [sessionId]);

  const handleCopy = async () => {
    if (!transcript) return;
    await navigator.clipboard.writeText(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-3"
        >
          <Loader size={24} className="text-[#e8317a] animate-spin" />
          <p className="text-[13px] text-[#888888]">Loading transcript...</p>
        </motion.div>
      </div>
    );
  }

  if (!transcript) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-3"
        >
          <p className="text-[16px] text-[#f0f0f0]">No transcript available</p>
          <p className="text-[13px] text-[#888888]">
            This session hasn't been transcribed yet
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a2a]">
        <div>
          <h2 className="text-[16px] font-medium text-[#f0f0f0]">
            Transcription
          </h2>
          <p className="text-[11px] text-[#888888] mt-0.5">
            {transcript.split(/\s+/).length} words
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#161616] border border-[#2a2a2a] text-[#aaaaaa] hover:border-[#e8317a] hover:text-[#f0f0f0] transition-colors"
        >
          {copied ? (
            <>
              <Check size={14} className="text-[#22c55e]" />
              Copied
            </>
          ) : (
            <>
              <Copy size={14} />
              Copy
            </>
          )}
        </motion.button>
      </div>

      {/* Transcript body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="max-w-[720px]"
        >
          <p className="text-[14px] leading-[1.8] text-[#cccccc] whitespace-pre-wrap">
            {transcript}
          </p>
        </motion.div>
      </div>
    </div>
  );
}
