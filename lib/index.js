// Host half of dsh-usage-bar.
//
// The bottom bar is rendered entirely in the browser: the client bundle is
// discovered through package.json `dsh.client` and served at
// /plugins/dsh-usage-bar/client.js. This half is an empty plugin body so the
// package can sit in the Cordis tree (the host scans loader entries for
// `dsh.client` declarations and composes the boot manifest from them).

export function apply() {}
