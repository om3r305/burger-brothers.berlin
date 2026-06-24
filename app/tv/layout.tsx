// app/tv/layout.tsx
export const metadata = {
  title: "Burger Brothers • TV",
  description: "Burger Brothers – Küchenmonitor",
  manifest: "/manifest-tv.webmanifest?v=5",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Burger TV",
  },
};

export default function TVLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <link rel="manifest" href="/manifest-tv.webmanifest?v=5" />
      <style dangerouslySetInnerHTML={{ __html: `footer{display:none!important}` }} />
      {children}
    </div>
  );
}
