import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { motion } from 'motion/react'
import { Mic, LayoutGrid, FileText, BarChart3, RotateCcw } from 'lucide-react'

interface DashboardPageProps {
  onSignOut: () => void
}

export function DashboardPage({ onSignOut }: DashboardPageProps) {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<'graph' | 'transcript' | 'summary'>('graph')
  const [isRecording, setIsRecording] = useState(false)
  const [hasRecorded, setHasRecorded] = useState(false)

  const handleStopRecording = () => {
    setIsRecording(false)
    setHasRecorded(true)
  }

  return (
    <div className="w-screen h-screen bg-[#0d0d0d] flex relative overflow-hidden">
      {/* Dot grid background */}
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, #2a2a2a 0.5px, transparent 0.5px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Gradient orb */}
      <motion.div
        className="absolute w-[600px] h-[600px] rounded-full blur-[120px] opacity-20 pointer-events-none"
        style={{
          background: 'radial-gradient(circle, #e8317a 0%, transparent 70%)',
        }}
        animate={{
          x: [0, 50, -50, 0],
          y: [0, -50, 50, 0],
          scale: [1, 1.1, 0.9, 1],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: 'easeInOut',
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
            setHasRecorded(false)
            setIsRecording(false)
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
            <h1 className="text-[17px] font-medium text-[#f0f0f0]">Graph-fil-A</h1>
          </div>
          <p className="text-[11px] text-[#888888]">Voice → Knowledge Graph</p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex-1 px-4 py-4">
          <h2 className="text-[10px] uppercase text-[#888888] tracking-[1.2px] mb-3">Workspace</h2>
          <nav className="space-y-1">
            {/* Graph Tab */}
            <button
              onClick={() => setActiveTab('graph')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-[13px] border-l-2 -ml-4 pl-[14px] transition-colors ${
                activeTab === 'graph'
                  ? 'text-[#f0f0f0] border-[#e8317a]'
                  : 'text-[#888888] hover:text-[#f0f0f0] border-transparent'
              }`}
            >
              <LayoutGrid size={14} />
              <span>Graph</span>
            </button>

            {/* Transcription Tab */}
            <button
              onClick={() => setActiveTab('transcript')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-[13px] border-l-2 -ml-4 pl-[14px] transition-colors ${
                activeTab === 'transcript'
                  ? 'text-[#f0f0f0] border-[#e8317a]'
                  : 'text-[#888888] hover:text-[#f0f0f0] border-transparent'
              }`}
            >
              <FileText size={14} />
              <span>Transcription</span>
            </button>

            {/* Summary Tab */}
            <button
              onClick={() => setActiveTab('summary')}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-[13px] border-l-2 -ml-4 pl-[14px] transition-colors ${
                activeTab === 'summary'
                  ? 'text-[#f0f0f0] border-[#e8317a]'
                  : 'text-[#888888] hover:text-[#f0f0f0] border-transparent'
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
              {user?.email?.substring(0, 2).toUpperCase() || 'U'}
            </div>
            <div>
              <p className="text-[12px] font-medium text-[#f0f0f0]">{user?.email?.split('@')[0] || 'User'}</p>
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
          className="flex flex-col items-center justify-center gap-8"
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
                    ease: 'easeOut',
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
                    ease: 'easeOut',
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
                  handleStopRecording()
                } else {
                  setIsRecording(true)
                }
              }}
              whileHover={{ scale: isRecording ? 1 : 1.05 }}
              whileTap={{ scale: 0.95 }}
              animate={isRecording ? { scale: [1, 1.02, 1] } : {}}
              transition={isRecording ? { duration: 0.6, repeat: Infinity } : {}}
              className={`w-[120px] h-[120px] rounded-full flex items-center justify-center shadow-lg transition-all relative z-10 ${
                isRecording
                  ? 'bg-gradient-to-br from-[#ef4444] to-[#dc2626]'
                  : 'bg-gradient-to-br from-[#e8317a] to-[#d02a6e] hover:from-[#d02a6e] hover:to-[#b82359]'
              }`}
            >
              {isRecording ? (
                <motion.div
                  className="w-[48px] h-[48px] bg-white rounded"
                />
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
                  <h2 className="text-[24px] font-medium text-[#f0f0f0]">Recording...</h2>
                </div>
                <p className="text-[13px] text-[#888888]">Click the square to stop</p>
              </>
            ) : (
              <>
                <h2 className="text-[24px] font-medium text-[#f0f0f0] mb-2">Start Recording</h2>
                <p className="text-[13px] text-[#888888]">Click the microphone to begin</p>
              </>
            )}

            {/* Generate Graph Button */}
            {hasRecorded && !isRecording && (
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="mt-8 px-8 py-3.5 bg-gradient-to-r from-[#e8317a] to-[#d02a6e] text-white rounded-lg text-[16px] font-medium hover:from-[#d02a6e] hover:to-[#b82359] transition-all shadow-lg"
              >
                Generate Graph
              </motion.button>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
