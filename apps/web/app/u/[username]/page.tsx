'use client'

import React, { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import Image from 'next/image'
import Link from 'next/link'

export default function UserProfilePage({ params }: { params: { username: string } }) {
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchUser = async () => {
      try {
        if (!db) throw new Error('Firestore not initialized')
        const ref = doc(db, 'users', params.username)
        const snap = await getDoc(ref)
        if (snap.exists()) {
          setUser(snap.data())
        } else {
          console.warn('User not found:', params.username)
        }
      } catch (err) {
        console.error('Error fetching user:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchUser()
  }, [params.username])

  if (loading) return <div className="flex items-center justify-center min-h-screen">Loading profile...</div>
  if (!user)
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-center">
        <h1 className="text-3xl font-bold mb-2">User not found</h1>
        <p className="text-gray-500 mb-4">No profile for @{params.username}</p>
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
          alt={user.displayName || params.username}
          width={120}
          height={120}
          className="rounded-full shadow mb-4"
        />
      )}
      <h1 className="text-3xl font-bold mb-1">{user.displayName || params.username}</h1>
      <p className="text-gray-600 mb-4">@{params.username}</p>
      {user.bio && <p className="text-gray-700 max-w-md">{user.bio}</p>}
    </div>
  )
}
