cask "kolang-ide" do
  version "__VERSION__"
  sha256 "__SHA256__"

  url "https://github.com/faralidev/kolang-ide/releases/download/v#{version}/kolang-ide-#{version}-universal.dmg"
  name "Kolang IDE"
  desc "Desktop IDE for the Kolang Persian programming language"
  homepage "https://github.com/faralidev/kolang-ide"

  # Universal binary — works on both Apple Silicon and Intel Macs.
  # The bundled Electron 33 runtime requires macOS 11 (Big Sur) or newer.
  depends_on macos: :big_sur

  app "kolang-ide.app"

  # The kolang interpreter + linter are bundled inside the app, so no extra
  # brew dependencies are needed to run Kolang programs.

  caveats do
    <<~EOS
      kolang-ide is currently UNSIGNED. On first launch, macOS Gatekeeper
      will block it. To open:
        1. Right-click kolang-ide.app → "Open"
        2. Confirm "Open" in the dialog
      This is a one-time step per install.
    EOS
  end

  zap trash: [
    "~/Library/Application Support/kolang-ide",
    "~/Library/Preferences/ir.kolang.ide.plist",
    "~/Library/Saved Application State/ir.kolang.ide.savedState",
  ]
end
