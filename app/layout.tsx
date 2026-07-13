import type { Metadata } from "next";
import "./globals.css";

const title = "FulfilRate — Delivery & RTS Forecasts";
const description =
  "Upload an order-status Excel file and calculate product-level delivery rates, RTS rates, and in-transit forecasts for every sender.";
const imageUrl =
  "https://fulfilrate-forecast.proud-carp-2250.chatgpt.site/og.png";

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    images: [
      {
        url: imageUrl,
        width: 1731,
        height: 909,
        alt: "FulfilRate delivery intelligence dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [imageUrl],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
