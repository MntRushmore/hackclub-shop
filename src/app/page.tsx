"use client";

import React from "react";
import Link from "next/link";
import Navigation from "./components/Navigation";
import Image from "next/image";

const MainPage = () => {
  return (
    <div className="bg-hackclub-dark min-h-screen flex flex-col relative">
      {/* Navigation */}
      <Navigation />

      <div className="flex flex-grow items-center justify-center text-white text-center px-6 relative z-10">
        <div className="max-w-3xl w-full">
          <h1 className="text-6xl font-extrabold mb-8">
            Welcome to the Hack Club Shop
          </h1>
          <p className="text-xl mb-8 max-w-xl mx-auto">
            Preorder exclusive merch designed by and for Hack Clubbers. T-shirts,
            hoodies, stickers, and more!
          </p>
          <Link
            href="/shop"
            className="text-white bg-hackclub-red py-4 px-10 rounded-full text-xl hover:bg-red-700 transition-all duration-300"
          >
            Start Preordering
          </Link>
        </div>
      </div>

      {/* Background Images */}
      <div className="absolute inset-0 flex justify-center items-center pointer-events-none">
        <Image
          src={"https://hackclub.com/stickers/orpheus_flag.svg"}
          alt="Hack Club logo"
          width={300}
          height={300}
          className="absolute left-10 opacity-30 rotate-12"
        />
        <Image
          src={"https://hackclub.com/stickers/orpheus-having-boba.png"}
          alt="Hack Club logo"
          width={200}
          height={200}
          className="absolute top-1/2 -translate-y-1/2 right-16 opacity-30 -rotate-12"
        />
        <Image
          src={"https://hackclub.com/stickers/hack_to_the_future.svg"}
          alt="Hack Club logo"
          width={250}
          height={250}
          className="absolute bottom-20 left-36 -translate-x-1/2 opacity-30 rotate-6"
        />
        <Image
          src={"https://hackclub.com/stickers/macintosh.svg"}
          alt="Hack Club logo"
          width={125}
          height={150}
          className="absolute bottom-20 right-32 -translate-x-1/2 opacity-30 rotate-6"
        />
      </div>

      <footer className="text-center text-white py-6 bg-hackclub-dark z-10">
        © 2026 Hack Club. 501(c)(3) nonprofit.
      </footer>
    </div>
  );
};

export default MainPage;