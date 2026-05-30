export default function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Standalone layout — no Navbar or Footer
  return <>{children}</>;
}
