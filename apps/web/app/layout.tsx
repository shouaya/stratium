import type { ReactNode } from "react";

export const metadata = {
  title: "Stratium Weget",
  description: "Trading simulation core and Web prototype"
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
