import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center"
         style={{ background: 'linear-gradient(135deg, #060E1E 0%, #0D1B2E 60%, #0F2040 100%)' }}>
      <SignIn />
    </div>
  );
}
