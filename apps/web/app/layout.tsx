import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Stratium Weget",
  description: "Trading simulation core and Web prototype",
  icons: {
    icon: [
      {
        url: "/favicon.png",
        type: "image/png"
      }
    ],
    shortcut: ["/favicon.png"],
    apple: [
      {
        url: "/favicon.png",
        type: "image/png"
      }
    ]
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          background: "#071116",
          overflowX: "hidden",
          overflowY: "auto",
          scrollbarWidth: "none",
          msOverflowStyle: "none"
        }}
      >
        <style>{`
          html, body {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }

          html::-webkit-scrollbar,
          body::-webkit-scrollbar {
            width: 0;
            height: 0;
            display: none;
          }
        `}</style>
        {children}
      </body>
    </html>
  );
}
