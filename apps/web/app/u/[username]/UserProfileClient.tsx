'use client'

import React, { useEffect, useState } from 'react'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import Image from 'next/image'
import Link from 'next/link'

export default function UserProfileClient({ username }: { username: string }) {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('username', '==', username));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
          setUser(querySnapshot.docs[0].data());
        }
      } catch (err) {
        console.error('Error fetching user:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchUser()
  }, [username])

  if (loading)
    return <div className="flex items-center justify-center min-h-screen text-gray-500">Loading profile...</div>

  if (!user)
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-center">
        <h1 className="text-3xl font-bold mb-2">User not found</h1>
        <p className="text-gray-500 mb-4">No profile for @{username}</p>
        <Link href="/" className="text-blue-600 underline">
          ← Back to home
        </Link>
      </div>
    )

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center">
      {user.photoURL && (
        <Image
          src={user.photoURL}
          alt={user.displayName || username}
          width={120}
          height={120}
          className="rounded-full shadow mb-4"
        />
      )}
      <h1 className="text-3xl font-bold mb-1">{user.displayName || username}</h1>
      <p className="text-gray-600 mb-4">@{username}</p>
      {user.bio && <p className="text-gray-700 max-w-md">{user.bio}</p>}
    </div>
  )
}
