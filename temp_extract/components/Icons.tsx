
import React from 'react';

export const UploadIcon: React.FC<{className?: string}> = ({className}) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);

export const CheckCircleIcon: React.FC<{className?: string}> = ({className}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
);

export const UsersIcon: React.FC<{className?: string}> = ({className}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.653-.124-1.282-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.653.124-1.282.356-1.857m0 0a3.004 3.004 0 01-3.71-1.549M12 18c-3.314 0-6-2.686-6-6s2.686-6 6-6 6 2.686 6 6-2.686 6-6 6zm0 0a3.004 3.004 0 003.71-1.549m-3.71 1.549A3.004 3.004 0 0112 18zm-3.71-1.549A3.004 3.004 0 0012 18" />
    </svg>
);

export const CrownIcon: React.FC<{className?: string}> = ({className}) => (
    <svg xmlns="http://www.w.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.5 14h-7a1 1 0 00-1 1v2a1 1 0 001 1h7a1 1 0 001-1v-2a1 1 0 00-1-1z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 11V6a2 2 0 012-2h10a2 2 0 012 2v5l-1.42 1.42A2 2 0 0116.172 13H7.828a2 2 0 01-1.414-.586L5 11zM12 2v2" />
    </svg>
);
