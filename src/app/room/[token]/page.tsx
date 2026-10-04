import { DataRoomClient } from './data-room-client'

export default async function DataRoomPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <DataRoomClient token={token} />
}
