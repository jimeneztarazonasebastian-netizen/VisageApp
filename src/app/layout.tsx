import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Rostro · Editor de caras",
  description: "Edita tus selfies como en FaceApp: sonrisa, retoque, forma, maquillaje, cabello, fondo y filtros. Todo en tu teléfono.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Rostro" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geist.variable} h-full bg-black antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
