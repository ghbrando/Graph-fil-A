import { useState } from 'react'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import './App.css'

function App() {
  const [currentPage, setCurrentPage] = useState<'login' | 'signup'>('login')

  return (
    <>
      {currentPage === 'login' ? (
        <LoginPage
          onLogin={() => console.log('Login')}
          onSignupClick={() => setCurrentPage('signup')}
        />
      ) : (
        <SignupPage
          onSignup={() => console.log('Signup')}
          onLoginClick={() => setCurrentPage('login')}
        />
      )}
    </>
  )
}

export default App
