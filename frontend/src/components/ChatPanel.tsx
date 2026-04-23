import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "motion/react";
import { Send, Loader, Sparkles } from "lucide-react";
import { getIdToken } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../lib/firebase";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  highlightNodes?: string[];
}

interface GraphNodeRef {
  id: string;
  label: string;
}

interface ChatPanelProps {
  sessionId: string;
  onHighlight?: (nodeIds: string[]) => void;
  nodeLookup?: Record<string, GraphNodeRef>;
}

export function ChatPanel({
  sessionId,
  onHighlight,
  nodeLookup,
}: ChatPanelProps) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setHistory([]);
    setPendingUser(null);
    setError(null);
    const unsubscribe = onSnapshot(
      doc(db, "sessions", sessionId),
      (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        const raw = (data.chatHistory ?? []) as ChatMessage[];
        setHistory(
          raw.map((m) => ({
            role: m.role,
            content: m.content,
            highlightNodes: m.highlightNodes ?? [],
          })),
        );
      },
      (err) => {
        console.error("Chat history fetch error:", err);
      },
    );
    return () => unsubscribe();
  }, [sessionId]);

  useEffect(() => {
    setPendingUser(null);
  }, [history]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [history, pendingUser, isSending]);

  const handleSend = useCallback(async () => {
    const message = input.trim();
    if (!message || isSending) return;

    setInput("");
    setError(null);
    setPendingUser(message);
    setIsSending(true);
    onHighlight?.([]);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      if (!auth.currentUser) throw new Error("Not signed in");
      const token = await getIdToken(auth.currentUser);
      const res = await fetch(
        `${import.meta.env.VITE_API_GATEWAY_URL}/sessions/${sessionId}/chat`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message }),
        },
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Request failed (${res.status})`);
      }
      const data = (await res.json()) as {
        answer: string;
        highlightNodes?: string[];
      };
      if (data.highlightNodes && data.highlightNodes.length > 0) {
        onHighlight?.(data.highlightNodes);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      setPendingUser(null);
    } finally {
      setIsSending(false);
    }
  }, [input, isSending, onHighlight, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const getNodeLabel = (id: string) => nodeLookup?.[id]?.label ?? id;

  return (
    <div className="w-[320px] h-full bg-[#111111] border-l border-[#2a2a2a] flex flex-col relative z-10 min-h-0">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-[#2a2a2a] flex items-center gap-2 shrink-0">
        <div className="w-[28px] h-[28px] rounded-lg bg-gradient-to-br from-[#e8317a] to-[#8b5cf6] flex items-center justify-center">
          <Sparkles size={14} className="text-white" />
        </div>
        <div>
          <h2 className="text-[13px] font-medium text-[#f0f0f0] leading-tight">
            AI assistant
          </h2>
          <p className="text-[10px] text-[#888888]">
            Ask about this session
          </p>
        </div>
      </div>

      {/* Message thread */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0"
      >
        {history.length === 0 && !pendingUser && !isSending && !error && (
          <div className="flex flex-col items-center text-center gap-2 py-10 px-2">
            <div className="w-[36px] h-[36px] rounded-full bg-[#1a1025] border border-[#2d1f3d] flex items-center justify-center">
              <Sparkles size={16} className="text-[#e8317a]" />
            </div>
            <p className="text-[12.5px] text-[#aaaaaa]">No messages yet.</p>
            <p className="text-[11px] text-[#666666] leading-[1.5]">
              Ask about entities, decisions, or relationships in this session.
            </p>
          </div>
        )}

        {history.map((message, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div
              className={`rounded-lg p-3 text-[12.5px] leading-[1.55] whitespace-pre-wrap break-words ${
                message.role === "user"
                  ? "bg-[#1c1c1c] border border-[#2a2a2a] text-[#f0f0f0]"
                  : "bg-gradient-to-br from-[#1a1025] to-[#17121f] border border-[#2d1f3d] text-[#e0d5f0]"
              }`}
            >
              {message.content}
            </div>
            {message.role === "assistant" &&
              message.highlightNodes &&
              message.highlightNodes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {message.highlightNodes.map((nodeId) => (
                    <span
                      key={nodeId}
                      className="px-2 py-0.5 rounded-full text-[10px] text-[#f7d2e4] bg-[#e8317a]/15 border border-[#e8317a]/40"
                      title={nodeId}
                    >
                      {getNodeLabel(nodeId)}
                    </span>
                  ))}
                </div>
              )}
          </motion.div>
        ))}

        {pendingUser && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="rounded-lg p-3 text-[12.5px] leading-[1.55] whitespace-pre-wrap break-words bg-[#1c1c1c] border border-[#2a2a2a] text-[#f0f0f0] opacity-80"
          >
            {pendingUser}
          </motion.div>
        )}

        {isSending && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 pl-1"
          >
            <Loader size={14} className="animate-spin text-[#e8317a]" />
            <span className="text-[11.5px] text-[#888888]">Thinking…</span>
          </motion.div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg bg-[#2a0d0d]/50 border border-[#ef4444]/40 px-3 py-2 text-[11.5px] text-[#fca5a5]"
          >
            {error}
          </motion.div>
        )}
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-[#2a2a2a] flex gap-2 shrink-0">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask about the graph…"
          rows={1}
          disabled={isSending}
          className="flex-1 bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-3 py-2 text-[12.5px] text-[#f0f0f0] placeholder-[#555555] resize-none focus:outline-none focus:border-[#e8317a] min-h-[36px] max-h-[120px] disabled:opacity-60 transition-colors"
        />
        <motion.button
          onClick={handleSend}
          disabled={isSending || !input.trim()}
          whileHover={{ scale: isSending || !input.trim() ? 1 : 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={`w-[36px] h-[36px] flex-shrink-0 rounded-lg flex items-center justify-center text-white transition-colors ${
            isSending || !input.trim()
              ? "bg-[#2a2a2a] text-[#555555] cursor-not-allowed"
              : "bg-gradient-to-br from-[#e8317a] to-[#d02a6e] hover:from-[#d02a6e] hover:to-[#b82359]"
          }`}
        >
          <Send size={14} />
        </motion.button>
      </div>
    </div>
  );
}
