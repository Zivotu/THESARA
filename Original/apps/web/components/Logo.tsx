import Image from 'next/image';
import Link from 'next/link';
import LogoImage from '../../../assets/Thesara_Logo.png';
import { SITE_NAME } from '@/lib/config';

export default function Logo({ className = '' }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center ${className}`}>
      <Image
        src={LogoImage}
        alt={`${SITE_NAME} logo`}
        width={500}
        height={237}
        style={{ color: 'transparent' }}
        className="h-10 w-auto rounded-xl object-contain"
      />
    </Link>
  );
}
