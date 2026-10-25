; Cloudy installer pages — welcome text in Italian with the Cloudee sidebar.
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Benvenuto in Cloudy"
  !define MUI_WELCOMEPAGE_TEXT "Cloudy Desktop ti porta il chatbot Cloudy con il suo agente Code e Cowork, i modelli Cloudy e Claude (tramite Claude Code o chiave API), provider personalizzati, plugin, skills, connettori e un computer Linux tutto suo.$\r$\n$\r$\nFai clic su Avanti per continuare."
  !insertmacro MUI_PAGE_WELCOME
!macroend
