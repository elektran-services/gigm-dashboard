export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-neutral-600">The page you requested does not exist.</p>
      <a href="/" className="mt-6 text-blue-600 underline">
        Back to login
      </a>
    </div>
  );
}
