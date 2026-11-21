#!/bin/zsh
# Double-click: removes MAGIS Accounts from this Mac (moves the app to the Trash).
# Your database files (.db) are NOT touched: they are wherever you saved them.
APP="/Applications/MAGIS Accounts.app"
echo "MAGIS Accounts — désinstaller · Uninstall"
echo
if [ ! -d "$APP" ]; then
  echo "L'application n'est pas dans Applications · The app is not in Applications."
  echo "Appuyez sur Entrée · Press Enter"; read; exit 0
fi
echo "Cette action met « MAGIS Accounts » à la corbeille. Vos fichiers de données ne sont pas touchés."
echo "This moves « MAGIS Accounts » to the Trash. Your data files are not touched."
echo
read "ans?Continuer ? · Continue? (o/y = oui/yes) "
case "$ans" in o|O|y|Y|oui|yes|Yes)
  osascript -e 'tell application "MAGIS Accounts" to quit' >/dev/null 2>&1
  sleep 1
  osascript -e "tell application \"Finder\" to delete POSIX file \"$APP\"" >/dev/null 2>&1 && echo "✓ Fait · Done (dans la corbeille · in the Trash)" || echo "✗ Impossible · Could not — drag the app from Applications to the Trash"
  ;;
  *) echo "Annulé · Cancelled";;
esac
echo "Appuyez sur Entrée · Press Enter"; read
