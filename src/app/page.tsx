export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Hutch Core</h1>
      <p className="mt-2 text-sm text-gray-600">
        Headless MCP server for structured agent data. Single-user, self-hosted.
      </p>
      <dl className="mt-8 space-y-4 text-sm">
        <div>
          <dt className="font-medium">MCP endpoint</dt>
          <dd>
            <code className="rounded bg-gray-100 px-2 py-1">/api/mcp</code>
          </dd>
        </div>
        <div>
          <dt className="font-medium">Source</dt>
          <dd>
            <a
              className="text-blue-600 underline"
              href="https://github.com/hutchdb/hutch"
            >
              github.com/hutchdb/hutch
            </a>
          </dd>
        </div>
      </dl>
    </main>
  );
}
