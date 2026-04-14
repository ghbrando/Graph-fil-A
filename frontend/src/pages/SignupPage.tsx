import { useState } from 'react';
import { motion } from 'motion/react';
import { signUp } from '../lib/authService';
import { parseAuthError } from '../lib/authService';

interface SignupPageProps {
  onSignup?: () => void;
  onLoginClick?: () => void;
}

export function SignupPage({ onSignup, onLoginClick }: SignupPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!agreeToTerms) {
      setError('Please agree to the Terms of Service and Privacy Policy');
      return;
    }

    setIsLoading(true);
    try {
      await signUp(email, password);
      onSignup?.();
    } catch (err) {
      setError(parseAuthError(err));
    } finally {
      setIsLoading(false);
    }
  };

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

      {/* Signup card */}
      <motion.div
        className="relative z-10 w-full max-w-[420px] mx-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-[10px] h-[10px] rounded-full bg-[#e8317a]" />
            <h1 className="text-[32px] font-medium text-[#f0f0f0]">Graph-fil-A</h1>
          </div>
          <p className="text-[14px] text-[#888888]">Voice → Knowledge Graph</p>
        </div>

        {/* Signup form */}
        <div className="bg-[#161616] border border-[#2a2a2a] rounded-2xl p-8">
          <h2 className="text-[20px] font-medium text-[#f0f0f0] mb-2">Create your account</h2>
          <p className="text-[13px] text-[#888888] mb-6">Join us and start building your knowledge graphs</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-[12px] text-[#aaaaaa] mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-[13px] text-[#f0f0f0] placeholder-[#555555] focus:outline-none focus:border-[#e8317a] transition-colors"
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-[12px] text-[#aaaaaa] mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-[13px] text-[#f0f0f0] placeholder-[#555555] focus:outline-none focus:border-[#e8317a] transition-colors"
                placeholder="Create a password"
                required
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-[12px] text-[#aaaaaa] mb-2">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-[#1c1c1c] border border-[#2a2a2a] rounded-lg px-4 py-2.5 text-[13px] text-[#f0f0f0] placeholder-[#555555] focus:outline-none focus:border-[#e8317a] transition-colors"
                placeholder="Confirm your password"
                required
              />
            </div>

            <div className="flex items-start gap-2 text-[12px]">
              <label className="flex items-start gap-2 text-[#888888] cursor-pointer pt-0.5">
                <input
                  type="checkbox"
                  checked={agreeToTerms}
                  onChange={(e) => setAgreeToTerms(e.target.checked)}
                  className="w-4 h-4 bg-[#1c1c1c] border border-[#2a2a2a] rounded accent-[#e8317a] mt-0.5"
                />
                <span>
                  I agree to the{' '}
                  <a href="#" className="text-[#e8317a] hover:text-[#d02a6e] transition-colors">
                    Terms of Service
                  </a>{' '}
                  and{' '}
                  <a href="#" className="text-[#e8317a] hover:text-[#d02a6e] transition-colors">
                    Privacy Policy
                  </a>
                </span>
              </label>
            </div>

            {error && (
              <p className="text-[12px] text-[#e8317a]">{error}</p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#e8317a] text-white py-2.5 rounded-lg text-[13px] font-medium hover:bg-[#d02a6e] transition-colors mt-6 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Creating account...' : 'Create account'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-[#2a2a2a] text-center">
            <p className="text-[12px] text-[#888888]">
              Already have an account?{' '}
              <button
                type="button"
                onClick={onLoginClick}
                className="text-[#e8317a] hover:text-[#d02a6e] transition-colors cursor-pointer bg-none border-none p-0"
              >
                Sign in
              </button>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-[#555555] mt-8">
          By signing up, you agree to our{' '}
          <a href="#" className="text-[#888888] hover:text-[#f0f0f0] transition-colors">
            Terms of Service
          </a>{' '}
          and{' '}
          <a href="#" className="text-[#888888] hover:text-[#f0f0f0] transition-colors">
            Privacy Policy
          </a>
        </p>
      </motion.div>
    </div>
  );
}
