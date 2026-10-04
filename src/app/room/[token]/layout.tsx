import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Data Room',
  description: 'Secure document sharing',
  robots: 'noindex, nofollow',
}

export default function DataRoomLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white antialiased">
      {children}
    </div>
  )
}
