import { useAuth } from '../context/AuthContext'
import { motion } from 'motion/react'

interface DashboardPageProps {
  onSignOut: () => void
}

export function DashboardPage({ onSignOut }: DashboardPageProps) {
  const { user } = useAuth()

  return (
    <div className="w-screen h-screen bg-[#0d0d0d] flex items-center justify-center relative overflow-hidden">
      {/* Dot grid background */}
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: 'radial-gradient(circle, #2a2a2a 0.5px, transparent 0.5px)',
          backgroundSize: '28px 28px',
        }}
      />

      {/* Gradient orb */}
      <motion.div
        className="absolute w-[600px] h-[600px] rounded-full blur-[120px] opacity-20"
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

      {/* Dashboard card */}
      <motion.div
        className="relative z-10 w-full max-w-[420px] mx-4 text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-[10px] h-[10px] rounded-full bg-[#e8317a]" />
          <h1 className="text-[32px] font-medium text-[#f0f0f0]">Graph-fil-A</h1>
        </div>

        <div className="bg-[#161616] border border-[#2a2a2a] rounded-2xl p-8">
          <h2 className="text-[20px] font-medium text-[#f0f0f0] mb-2">Welcome</h2>
          <p className="text-[13px] text-[#888888] mb-6">Signed in as</p>
          <p className="text-[14px] text-[#e8317a] font-medium mb-8">{user?.email}</p>

          <button
            onClick={onSignOut}
            className="w-full bg-[#161616] border border-[#2a2a2a] text-[#aaaaaa] px-6 py-2.5 rounded-lg text-[13px] font-medium hover:border-[#e8317a] hover:text-[#f0f0f0] transition-colors"
          >
            Sign out
          </button>
        </div>

        <p className="text-center text-[11px] text-[#555555] mt-8">
          Coming soon: knowledge graph interface
        </p>
      </motion.div>
    </div>
  )
}
