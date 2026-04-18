'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function EmployeeShortsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/employee-tracking'); }, [router]);
  return <div className="text-sw-dim text-center py-20">Redirecting to Employee Tracking…</div>;
}
