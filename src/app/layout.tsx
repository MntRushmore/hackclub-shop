import { CartProvider } from '../context/CartContext';
import { CreditsProvider } from '../context/CreditsContext';
import '../styles/globals.css';
import Navigation from './components/Navigation';
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hack Club Shop",
  description: "Buy your favorite Hack Club merch!",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://assets.hackclub.com/fonts/phantom-sans.css" />
      </head>
      <body className="antialiased">
        <CreditsProvider>
          <CartProvider>
            <Navigation />
            {children}
          </CartProvider>
        </CreditsProvider>
      </body>
    </html>
  );
}