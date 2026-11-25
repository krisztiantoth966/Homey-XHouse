# XHouse Gate for Homey

Neoficiálna Homey SDK v3 aplikácia na priame cloudové ovládanie brán a garážových ovládačov XHouse / Giigle IoT. Home Assistant nie je potrebný.

## Podporované zariadenia

- EGA18, EGA15 a ďalšie modely označené `EGA`
- EGB18, EGB1900 a ďalšie modely označené `EGB`
- modely označené `PGB` ako experimentálna kompatibilita s rodinou EGB
- XH-SGC01 Wi-Fi garage door controller

## Oprava vo verzii 1.0.3

Verzia 1.0.3 opravuje chybu `device.not.exist` pri EGA/EGB bránach. XHouse používa 18–19-ciferné identifikátory, ktoré bežný JavaScript `Number` zaokrúhli. Aplikácia ich teraz spracúva bez straty presnosti, skúša aj alternatívne ID v discovery odpovedi a dokáže automaticky opraviť zariadenie pridané staršou verziou.

## Funkcie

- otvorenie, zatvorenie a zastavenie brány EGA/EGB/PGB
- otvorenie a zatvorenie XH-SGC01
- fyzický stav: otvorená, zatvorená, otvára sa, zatvára sa, zastavená
- poloha 0–100 %, ak ju zariadenie poskytuje
- poloha ľavého a pravého krídla pri EGA
- online/offline dostupnosť
- bežný polling 5–300 sekúnd
- rýchly polling každé 2 sekundy počas 30 sekúnd po príkaze
- automatické obnovenie XHouse tokenu
- pairing a repair cez XHouse email a heslo
- vlastné Homey Flow karty

## Inštalácia

Kompletný slovenský postup je v [INSTALLATION_SK.md](INSTALLATION_SK.md).

V skratke:

```bash
npm install --global homey
homey login
cd com.tothk.xhouse
homey app validate
homey app install
```

Aplikácia nemá externé runtime npm závislosti, takže `npm install` v priečinku aplikácie nie je potrebný.

## Bezpečnosť a obmedzenia

Aplikácia komunikuje priamo s cloudom XHouse/Giigle IoT. Na ovládanie je preto potrebné internetové pripojenie a funkčná cloudová služba. Prihlasovacie údaje sú uložené v súkromnom device store aplikácie na Homey, pretože sú potrebné na automatické opätovné prihlásenie po expirácii tokenu.

Odporúča sa vytvoriť druhý XHouse účet, zdieľať mu domácnosť/bránu a tento účet použiť iba pre Homey. Prihlásenie cez neoficiálnu integráciu môže zneplatniť reláciu mobilnej aplikácie na tom istom účte.

Ide o neoficiálnu integráciu založenú na reverzne analyzovanom cloudovom API. Zmena API zo strany XHouse môže vyžadovať aktualizáciu aplikácie.

## Vývoj a testovanie

```bash
npm run validate
```

Príkaz vykoná kontrolu JavaScript syntaxe, statickú kontrolu manifestu a jednotkové testy protokolu.

## Attribution

Cloud API a parsovanie protokolu boli portované z projektu `BenJamesAndo/XHouse-IoT-Controller`. Podrobnosti a pôvodná MIT licencia sú v [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
