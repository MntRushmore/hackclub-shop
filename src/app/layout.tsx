import { CartProvider } from '../context/CartContext';
import { PointsProvider } from '../context/PointsContext';
import AuthProvider from '../context/AuthProvider';
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
      <head />
      <body className="antialiased">
        <AuthProvider>
          <PointsProvider>
            <CartProvider>
              <Navigation />
              {children}
            </CartProvider>
          </PointsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
