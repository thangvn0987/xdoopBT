import React from "react";

function GoogleIcon(props) {
  return (
    <svg
      {...props}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303C33.676 32.91 29.223 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.957 3.043l5.657-5.657C33.862 6.053 29.184 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.652-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.39 16.596 18.828 14 24 14c3.059 0 5.842 1.154 7.957 3.043l5.657-5.657C33.862 6.053 29.184 4 24 4 16.318 4 9.652 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.159 0 9.787-1.977 13.292-5.195l-6.143-5.196C29.091 35.693 26.671 36 24 36c-5.202 0-9.635-3.07-11.318-7.454l-6.53 5.027C9.47 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-1.356 3.233-4.152 5.692-7.651 6.609l6.143 5.196C36.882 38.571 40 33.91 40 28c0-1.341-.138-2.652-.389-3.917z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const handleGoogleLogin = () => {
    // Start OAuth via gateway -> auth-service
    window.location.href = "/api/auth/google";
  };

  return (
    <div className="min-h-screen bg-hero-gradient text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white/5 backdrop-blur-xl rounded-2xl p-8 shadow-soft border border-white/10">
        <div className="text-center space-y-3">
          <h1 className="text-4xl md:text-5xl font-extrabold">
            <span className="bg-text-gradient bg-clip-text text-transparent">
              AESP
            </span>
          </h1>
          <p className="text-slate-300">
            Practice English with AI, mentors, and a playful UI.
          </p>
        </div>

        <div className="mt-8">
          <button
            onClick={handleGoogleLogin}
            className="w-full inline-flex items-center justify-center gap-3 bg-white text-slate-900 hover:bg-slate-100 active:bg-slate-200 transition-colors rounded-xl py-3 px-4 font-medium shadow-soft"
            aria-label="Continue with Google"
          >
            <GoogleIcon className="w-5 h-5" />
            Continue with Google
          </button>
        </div>

        <div className="mt-6 text-center text-xs text-slate-400">
          By continuing you agree to our
          <a className="text-slate-200 hover:underline mx-1" href="#">
            {" "}
            Terms
          </a>
          and
          <a className="text-slate-200 hover:underline mx-1" href="#">
            {" "}
            Privacy Policy
          </a>
          .
        </div>
      </div>
    </div>
  );
}
