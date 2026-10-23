# Licensing scope

Purity 0.5.0 is unreleased. Its source and package metadata use Apache-2.0.
Published releases through 0.4.0 remain MIT; their npm artifacts and version tags
are not changed by this transition.

The full, unmodified Apache License 2.0 is in [LICENSE](../LICENSE). The project
attribution is in [NOTICE](../NOTICE). The original `Copyright (c) 2026
KoalaFacts` statement and complete MIT permission and warranty text for earlier
Purity source are retained in [LICENSES/Purity-MIT.txt](../LICENSES/Purity-MIT.txt).
This preserves the earlier notice rather than replacing its grant with a new
claim about historical releases.

## Third-party components

Third-party components retain their own terms. The Apache-2.0 package identifier
does not relicense dependencies or remove their notices.

`@purityjs/vite-plugin` declares `oxc-parser` 0.154.0 as an external runtime
dependency. The plugin build does not bundle the parser or its native bindings.
Its MIT attribution to VoidZero Inc. & Contributors and Boshen is retained in the
plugin's NOTICE and [LICENSES/oxc-parser-MIT.txt](../LICENSES/oxc-parser-MIT.txt).
The dependency's own distribution remains separately licensed. Core, SSR and CLI
declare no external runtime dependencies.

The current source attribution scan and emitted source maps found no other
embedded dependency source in these four packages. That bounded check is not
permission to delete notices from future imported or copied code. Preserve the
applicable copyright, permission and attribution text when adding such code.

## Package verification

Each package includes its own full LICENSE, NOTICE and retained Purity MIT text.
The Vite plugin also includes the parser MIT text. These files are explicit in
the package file lists so they survive packing outside the monorepo.

After building all four packages, run `npm run check:licenses`. It packs each
package, reads the actual tarball, and checks its version, SPDX identifier, full
license text and retained notices. It also checks the original Purity MIT text
and the external parser notice for accidental removal or changes. Normal CI and
the manually triggered publish workflow run this check before publication.

Preparing 0.5.0 does not publish it. The existing publish workflow still requires
an explicit matching version and its normal production environment approval.
