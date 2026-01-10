import { Disclosure, DisclosurePanel, Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useAuthenticator } from "@aws-amplify/ui-react";
import { useState } from "react";
import { signOut } from "aws-amplify/auth";

export default function Navbar() {
  const { user } = useAuthenticator((ctx) => [ctx.user]);
  const displayEmail =
    user?.signInDetails?.loginId || user?.username || "Account";

  const [loggingOut, setLoggingOut] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleLogout() {
    setErr(null);
    setLoggingOut(true);
    try {
      await signOut();
      window.location.href = "/";
    } catch (e: any) {
      setErr(e?.message ?? "Logout failed");
      setLoggingOut(false);
    }
  }

  return (
    <Disclosure
      as="nav"
      className="relative z-100 bg-gray-800 dark:bg-gray-800/50 dark:after:pointer-events-none dark:after:absolute dark:after:inset-x-0 dark:after:bottom-0 dark:after:h-px dark:after:bg-white/10"
    >
      <div className="mx-auto max-w-7xl px-2 sm:px-6 lg:px-8">
        <div className="relative flex h-16 items-center justify-between">
          <div className="flex flex-1 items-center justify-center sm:items-stretch sm:justify-start">
            <div className="flex shrink-0 items-center">
              <img
                alt="Your Company"
                src="../../src/assets/SharkFinderLogoSmall.png"
                className="h-8 w-auto"
              />
            </div>
          </div>

          <div className="absolute inset-y-0 right-0 flex items-center pr-2 sm:static sm:inset-auto sm:ml-6 sm:pr-0">

{displayEmail}
            <Menu as="div" className="relative ml-3">
              <MenuButton className="relative flex rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
                <span className="absolute -inset-1.5" />
                <span className="sr-only">Open user menu</span>
                <img
                  alt=""
                  src={`https://ui-avatars.com/api/?name=${encodeURIComponent((displayEmail?.[0] ?? "A").toUpperCase())}&length=1&background=4f39f6&color=ffffff&rounded=true&bold=true&size=128`}
                  className="size-8 rounded-full bg-gray-800 outline -outline-offset-1 outline-white/10"
                />
              </MenuButton>

              <MenuItems
                transition
                className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-white py-1 shadow-lg outline outline-black/5 transition data-closed:scale-95 data-closed:transform data-closed:opacity-0 data-enter:duration-100 data-enter:ease-out data-leave:duration-75 data-leave:ease-in dark:bg-gray-800 dark:shadow-none dark:-outline-offset-1 dark:outline-white/10"
              >

                <MenuItem>
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="block w-full cursor-pointer px-4 py-2 text-left text-sm text-gray-700 data-focus:bg-gray-100 data-focus:outline-hidden dark:text-gray-300 dark:data-focus:bg-white/5 disabled:opacity-60"
                  >
                    {loggingOut ? "Logging out..." : "Log Out"}
                  </button>
                </MenuItem>
              </MenuItems>
            </Menu>
          </div>
        </div>
      </div>

      <DisclosurePanel className="sm:hidden">
        <div className="space-y-1 px-2 pt-2 pb-3" />
      </DisclosurePanel>

      {err && (
        <div className="px-4 pb-2 text-sm text-red-400">
          {err}
        </div>
      )}
    </Disclosure>
  );
}
