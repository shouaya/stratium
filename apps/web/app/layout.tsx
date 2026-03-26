import type { ReactNode } from "react";

export const metadata = {
  title: "Stratium PH1",
  description: "Trading simulation core and Web prototype"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

