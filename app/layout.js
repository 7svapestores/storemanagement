import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';

export const metadata = {
  title: '7S Stores — Store Management System',
  description: 'Multi-store business intelligence platform for 7S Stores',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
