// ✅ SERVER COMPONENT (nije 'use client')
// Ova komponenta samo prosljeđuje parametar klijentskoj komponenti

import UserProfileClient from './UserProfileClient'

export default async function UserProfilePage({
  params,
}: {
  params: { username: string }
}) {
  return <UserProfileClient username={params.username} />
}
