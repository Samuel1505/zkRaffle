'use client';

import { useState } from 'react';
import { Wallet, Menu, X, Ticket } from 'lucide-react';

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isWalletConnected, setIsWalletConnected] = useState(false);

  const handleConnectWallet = () => {
    // Wallet connection logic will be implemented here
    setIsWalletConnected(!isWalletConnected);
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass-effect">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center animate-glow">
              <Ticket className="w-6 h-6 text-white" />
            </div>
            <span className="heading-sm gradient-text">zkRaffle</span>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-8">
            <a href="#how-it-works" className="body-md text-gray-700 hover:text-primary transition-colors">
              How It Works
            </a>
            <a href="#features" className="body-md text-gray-700 hover:text-primary transition-colors">
              Features
            </a>
            <a href="#raffles" className="body-md text-gray-700 hover:text-primary transition-colors">
              Active Raffles
            </a>
            <a href="#about" className="body-md text-gray-700 hover:text-primary transition-colors">
              About
            </a>
          </nav>

          {/* Connect Wallet Button */}
          <div className="hidden md:flex items-center gap-4">

            <appkit-button />
            {/* <button
              onClick={handleConnectWallet}
              className={`flex items-center gap-2 px-6 py-3 rounded-full font-medium transition-all duration-300 ${
                isWalletConnected
                  ? 'bg-(--success) text-white hover:bg-(--success)/90'
                  : 'gradient-primary text-white hover:shadow-lg hover:scale-105'
              }`}
            >
              <Wallet className="w-5 h-5" />
              <span>{isWalletConnected ? 'Connected' : 'Connect Wallet'}</span>
            </button> */}
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            {isMenuOpen ? (
              <X className="w-6 h-6 text-gray-700" />
            ) : (
              <Menu className="w-6 h-6 text-gray-700" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="md:hidden glass-effect border-t border-gray-200">
          <div className="px-4 py-6 space-y-4">
            <a
              href="#how-it-works"
              className="block body-md text-gray-700 hover:text-primary transition-colors py-2"
              onClick={() => setIsMenuOpen(false)}
            >
              How It Works
            </a>
            <a
              href="#features"
              className="block body-md text-gray-700 hover:text-primary transition-colors py-2"
              onClick={() => setIsMenuOpen(false)}
            >
              Features
            </a>
            <a
              href="#raffles"
              className="block body-md text-gray-700 hover:text-primary transition-colors py-2"
              onClick={() => setIsMenuOpen(false)}
            >
              Active Raffles
            </a>
            <a
              href="#about"
              className="block body-md text-gray-700 hover:text-primary transition-colors py-2"
              onClick={() => setIsMenuOpen(false)}
            >
              About
            </a>
            <button
              onClick={handleConnectWallet}
              className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full font-medium transition-all duration-300 ${
                isWalletConnected
                  ? 'bg-success text-white'
                  : 'gradient-primary text-white'
              }`}
            >
              <Wallet className="w-5 h-5" />
              <span>{isWalletConnected ? 'Connected' : 'Connect Wallet'}</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
}