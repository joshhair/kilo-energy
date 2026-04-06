import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center"
         style={{ background: 'linear-gradient(135deg, #0b0d11 0%, #0f1117 60%, #0f1117 100%)' }}>
      <SignIn />
    </div>
  );
}
