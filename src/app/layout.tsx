import { CartProvider } from '../context/CartContext';
import '../styles/globals.css';
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
        <CartProvider>
          {children}
        </CartProvider>
      </body>
    </html>
  );
}