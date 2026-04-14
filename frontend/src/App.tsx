import { useState, useEffect } from 'react'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { DashboardPage } from './pages/DashboardPage'
import { useAuth } from './context/AuthContext'
import { signOut } from './lib/authService'
import './App.css'

function App() {
  const [currentPage, setCurrentPage] = useState<'login' | 'signup' | 'dashboard'>('login')
  const { user, loading } = useAuth()

  useEffect(() => {
    if (!loading) {
      if (user) {
        setCurrentPage('dashboard')
      } else if (currentPage === 'dashboard') {
        setCurrentPage('login')
      }
    }
  }, [user, loading])

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch (error) {
      console.error('Sign out failed:', error)
    }
  }

  if (loading) {
    return (
      <div className="w-screen h-screen bg-[#0d0d0d] flex items-center justify-center">
        <div className="w-[10px] h-[10px] rounded-full bg-[#e8317a] animate-pulse" />
      </div>
    )
  }

  return (
    <>
      {currentPage === 'dashboard' ? (
        <DashboardPage onSignOut={handleSignOut} />
      ) : currentPage === 'login' ? (
        <LoginPage
          onLogin={() => {}}
          onSignupClick={() => setCurrentPage('signup')}
        />
      ) : (
        <SignupPage
          onSignup={() => {}}
          onLoginClick={() => setCurrentPage('login')}
        />
      )}
    </>
  )
}

export default App
