import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Loader, Copy, Check } from "lucide-react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";

interface SummaryPageProps {
  sessionId: string;
}

interface SummaryData {
  title?: string;
  overview?: string;
  keyPoints?: string[];
  decisions?: string[];
  actionItems?: string[];
}

export function SummaryPage({ sessionId }: SummaryPageProps) {
  const [summary, setSummary] = useState<SummaryData | null>(null);
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
        if (data.summaryJson) {
          setSummary(data.summaryJson as SummaryData);
        }
        if (data.transcript) {
          setTranscript(data.transcript as string);
        }
        setLoading(false);
      },
      (err) => {
        console.error("Summary fetch error:", err);
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [sessionId]);

  const handleCopy = async () => {
    if (!summary) return;
    const text = [
      summary.title && `# ${summary.title}`,
      summary.overview && `\n${summary.overview}`,
      summary.keyPoints?.length &&
        `\n## Key Points\n${summary.keyPoints.map((p) => `- ${p}`).join("\n")}`,
      summary.decisions?.length &&
        `\n## Decisions\n${summary.decisions.map((d) => `- ${d}`).join("\n")}`,
      summary.actionItems?.length &&
        `\n## Action Items\n${summary.actionItems.map((a) => `- ${a}`).join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n");
    await navigator.clipboard.writeText(text);
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
          <p className="text-[13px] text-[#888888]">Loading summary...</p>
        </motion.div>
      </div>
    );
  }

  if (!summary) {
    // If there's a transcript but no summary, the pipeline hasn't generated one yet
    return (
      <div className="flex-1 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-3"
        >
          <p className="text-[16px] text-[#f0f0f0]">No summary available</p>
          <p className="text-[13px] text-[#888888]">
            {transcript
              ? "Summary generation is not yet enabled for this session"
              : "This session hasn't been processed yet"}
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
          <h2 className="text-[16px] font-medium text-[#f0f0f0]">Summary</h2>
          {summary.title && (
            <p className="text-[11px] text-[#888888] mt-0.5">{summary.title}</p>
          )}
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

      {/* Summary body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="max-w-[720px] space-y-6"
        >
          {/* Overview */}
          {summary.overview && (
            <div>
              <p className="text-[14px] leading-[1.8] text-[#cccccc]">
                {summary.overview}
              </p>
            </div>
          )}

          {/* Key Points */}
          {summary.keyPoints && summary.keyPoints.length > 0 && (
            <div>
              <h3 className="text-[10px] uppercase text-[#888888] tracking-[1.2px] mb-2">
                Key Points
              </h3>
              <ul className="space-y-2">
                {summary.keyPoints.map((point, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <div className="w-[6px] h-[6px] rounded-full bg-[#e8317a] mt-[7px] flex-shrink-0" />
                    <p className="text-[13px] leading-[1.6] text-[#cccccc]">
                      {point}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Decisions */}
          {summary.decisions && summary.decisions.length > 0 && (
            <div>
              <h3 className="text-[10px] uppercase text-[#888888] tracking-[1.2px] mb-2">
                Decisions
              </h3>
              <ul className="space-y-2">
                {summary.decisions.map((decision, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <div className="w-[6px] h-[6px] rounded-full bg-[#22c55e] mt-[7px] flex-shrink-0" />
                    <p className="text-[13px] leading-[1.6] text-[#cccccc]">
                      {decision}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Action Items */}
          {summary.actionItems && summary.actionItems.length > 0 && (
            <div>
              <h3 className="text-[10px] uppercase text-[#888888] tracking-[1.2px] mb-2">
                Action Items
              </h3>
              <ul className="space-y-2">
                {summary.actionItems.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <div className="w-[6px] h-[6px] rounded-full bg-[#f59e0b] mt-[7px] flex-shrink-0" />
                    <p className="text-[13px] leading-[1.6] text-[#cccccc]">
                      {item}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
