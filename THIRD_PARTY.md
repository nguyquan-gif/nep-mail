# Third-party components

No Keila source is copied. The application uses open-source components installed through the package manager or official container images. These components retain upstream licenses.

Main application dependencies: React / React DOM (MIT), Lucide (ISC), Zod (MIT), Nodemailer (MIT-0). Build tools include TypeScript (Apache-2.0), Vite (MIT), Prettier (MIT) and Drizzle tooling (Apache-2.0). Confirm exact notices against locked package metadata before public release.

Containerized operational tools: Postfix (upstream distribution license), Mailpit (MIT), Node.js and Debian include their own notices and bundled component licenses. These images are referenced, not relicensed as Nếp Mail code. Node's SQLite module uses its bundled SQLite library.

The private hosted development checkout includes separately licensed starter code. That adapter and its platform tooling are omitted from the portable source archive. Run a full dependency/license audit and generate an SBOM from the final public release lockfile; this short inventory does not replace one.
