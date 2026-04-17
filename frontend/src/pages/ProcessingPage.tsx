import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { Check, Loader, Upload, Mic, Brain, AlertCircle, ArrowLeft } from "lucide-react";
import { doc, onSnapshot, getDoc } from "firebase/firestore";
import { db, auth } from "../lib/firebase";

interface ProcessingPageProps {
  sessionId: string;
  onBack: () => void;
}

type PipelineStatus =
  | "uploading"
  | "transcribing"
  | "transcribed"
  | "processing"
  | "ready"
  | "error";

interface Step {
  key: string;
  label: string;
  description: string;
  icon: typeof Upload;
}

const STEPS: Step[] = [
  { key: "uploading", label: "Uploading", description: "Sending audio to the cloud", icon: Upload },
  { key: "transcribing", label: "Transcribing", description: "Converting speech to text", icon: Mic },
  { key: "processing", label: "Processing", description: "Extracting knowledge graph", icon: Brain },
];

function getActiveStepIndex(status: PipelineStatus): number {
  switch (status) {
    case "uploading":
      return 0;
    case "transcribing":
      return 1;
    case "transcribed":
    case "processing":
      return 2;
    case "ready":
      return 3; // all complete
    case "error":
      return -1;
    default:
      return 0;
  }
}

export function ProcessingPage({ sessionId, onBack }: ProcessingPageProps) {
  const [status, setStatus] = useState<PipelineStatus>("uploading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    // Debug: check auth state and doc existence
    console.log("ProcessingPage: sessionId =", sessionId);
    console.log("ProcessingPage: auth.currentUser.uid =", auth.currentUser?.uid);
    getDoc(doc(db, "sessions", sessionId)).then((snap) => {
      console.log("ProcessingPage: doc exists =", snap.exists());
      if (snap.exists()) console.log("ProcessingPage: doc.uid =", snap.data().uid);
    }).catch((err) => console.error("ProcessingPage: getDoc error =", err));

    const unsubscribe = onSnapshot(
      doc(db, "sessions", sessionId),
      (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        if (data.status) {
          setStatus(data.status as PipelineStatus);
        }
        if (data.errorMessage) {
          setErrorMessage(data.errorMessage);
        }
      },
      (err) => {
        console.error("Firestore listener error:", err);
        setStatus("error");
        setErrorMessage("Lost connection to server");
      },
    );

    return () => unsubscribe();
  }, [sessionId]);

  const activeIndex = getActiveStepIndex(status);
  const isError = status === "error";
  const isFinished = status === "ready";

  return (
    <div className="w-screen h-screen bg-[#0d0d0d] flex items-center justify-center relative overflow-hidden">
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
          background: isError
            ? "radial-gradient(circle, #ef4444 0%, transparent 70%)"
            : isFinished
              ? "radial-gradient(circle, #22c55e 0%, transparent 70%)"
              : "radial-gradient(circle, #e8317a 0%, transparent 70%)",
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

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative z-10 flex flex-col items-center"
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-2">
          <div
            className={`w-[7px] h-[7px] rounded-full ${
              isError ? "bg-[#ef4444]" : isFinished ? "bg-[#22c55e]" : "bg-[#e8317a]"
            }`}
          />
          <h1 className="text-[17px] font-medium text-[#f0f0f0]">Graph-fil-A</h1>
        </div>
        <p className="text-[11px] text-[#888888] mb-12">
          {isFinished
            ? "Your graph is ready"
            : isError
              ? "Something went wrong"
              : "Building your knowledge graph"}
        </p>

        {/* Vertical Stepper */}
        <div className="flex flex-col gap-0 w-[360px]">
          {STEPS.map((step, index) => {
            const isComplete = activeIndex > index;
            const isCurrent = activeIndex === index && !isError;
            const isPending = activeIndex < index && !isError;
            const isErrorStep = isError && activeIndex === -1 && index === 0;

            const Icon = step.icon;

            return (
              <div key={step.key}>
                <motion.div
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.1 }}
                  className="flex items-center gap-4"
                >
                  {/* Step indicator */}
                  <div
                    className={`w-[44px] h-[44px] rounded-full flex items-center justify-center flex-shrink-0 border transition-colors duration-500 ${
                      isComplete
                        ? "bg-[#22c55e]/10 border-[#22c55e]/40"
                        : isCurrent
                          ? "bg-[#e8317a]/10 border-[#e8317a]/40"
                          : isErrorStep || isError
                            ? "bg-[#ef4444]/10 border-[#ef4444]/40"
                            : "bg-[#161616] border-[#2a2a2a]"
                    }`}
                  >
                    {isComplete ? (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                      >
                        <Check size={18} className="text-[#22c55e]" />
                      </motion.div>
                    ) : isCurrent ? (
                      <Loader size={18} className="text-[#e8317a] animate-spin" />
                    ) : (
                      <Icon
                        size={18}
                        className={
                          isPending ? "text-[#555555]" : "text-[#888888]"
                        }
                      />
                    )}
                  </div>

                  {/* Step text */}
                  <div>
                    <p
                      className={`text-[14px] font-medium transition-colors duration-500 ${
                        isComplete
                          ? "text-[#22c55e]"
                          : isCurrent
                            ? "text-[#f0f0f0]"
                            : "text-[#555555]"
                      }`}
                    >
                      {isComplete ? `${step.label} complete` : step.label}
                    </p>
                    <p
                      className={`text-[12px] transition-colors duration-500 ${
                        isCurrent ? "text-[#888888]" : "text-[#444444]"
                      }`}
                    >
                      {step.description}
                    </p>
                  </div>
                </motion.div>

                {/* Connector line */}
                {index < STEPS.length - 1 && (
                  <div className="flex items-stretch ml-[21px] py-1">
                    <div
                      className={`w-[2px] h-[28px] rounded-full transition-colors duration-500 ${
                        isComplete ? "bg-[#22c55e]/40" : "bg-[#2a2a2a]"
                      }`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Finished State */}
        {isFinished && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="mt-10 flex flex-col items-center gap-4"
          >
            <div className="w-[64px] h-[64px] rounded-full bg-[#22c55e]/10 border border-[#22c55e]/30 flex items-center justify-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.3 }}
              >
                <Check size={28} className="text-[#22c55e]" />
              </motion.div>
            </div>
            <p className="text-[16px] font-medium text-[#f0f0f0]">Finished</p>
            <p className="text-[13px] text-[#888888]">
              Your knowledge graph has been generated
            </p>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onBack}
              className="mt-2 px-6 py-2.5 rounded-lg text-[14px] font-medium bg-gradient-to-r from-[#e8317a] to-[#d02a6e] text-white hover:from-[#d02a6e] hover:to-[#b82359] transition-all shadow-lg"
            >
              Back to Dashboard
            </motion.button>
          </motion.div>
        )}

        {/* Error State */}
        {isError && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="mt-10 flex flex-col items-center gap-3"
          >
            <div className="w-[64px] h-[64px] rounded-full bg-[#ef4444]/10 border border-[#ef4444]/30 flex items-center justify-center">
              <AlertCircle size={28} className="text-[#ef4444]" />
            </div>
            <p className="text-[16px] font-medium text-[#f0f0f0]">
              Processing Failed
            </p>
            <p className="text-[13px] text-[#888888] text-center max-w-[300px]">
              {errorMessage || "An unexpected error occurred"}
            </p>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onBack}
              className="mt-2 flex items-center gap-2 px-6 py-2.5 rounded-lg text-[14px] font-medium bg-[#161616] border border-[#2a2a2a] text-[#f0f0f0] hover:border-[#e8317a] transition-colors"
            >
              <ArrowLeft size={16} />
              Back to Dashboard
            </motion.button>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
