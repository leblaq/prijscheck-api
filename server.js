import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 3000;


/* =========================
   TEST ROUTE
========================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "Prijscheck API werkt"
  });
});


/* =========================
   TELEFOONNUMMER NORMALISEREN
========================= */

function normalizePhoneNumber(phone, country = "") {

  if (!phone) {
    return null;
  }

  let cleaned = phone
    .toString()
    .trim()
    .replace(/[^\d+]/g, "");


  if (cleaned.startsWith("+")) {
    return cleaned;
  }


  if (cleaned.startsWith("00")) {
    return `+${cleaned.substring(2)}`;
  }


  if (
    country === "NL" &&
    cleaned.startsWith("0")
  ) {
    return `+31${cleaned.substring(1)}`;
  }


  if (
    country === "BE" &&
    cleaned.startsWith("0")
  ) {
    return `+32${cleaned.substring(1)}`;
  }


  return cleaned;
}


/* =========================
   SMS VERSTUREN VIA BIRD
========================= */

app.post("/api/send-sms", async (req, res) => {

  try {

const {
  recordId,
  telefoon,
  country,
  message,
  messageType,
  smsType
} = req.body;

const isIndicatie =
  String(smsType || "")
    .trim()
    .toLowerCase() === "indicatie";
     const isReceipt =
  messageType === "receipt";

    /* =========================
       BASISCONTROLE
    ========================= */

    if (!recordId) {

      return res.status(400).json({
        ok: false,
        error: "recordId ontbreekt"
      });

    }


    if (!telefoon) {

      return res.status(400).json({
        ok: false,
        error: "Telefoonnummer ontbreekt"
      });

    }


    if (!message) {

      return res.status(400).json({
        ok: false,
        error: "SMS bericht ontbreekt"
      });

    }


    /* =========================
       BIRD CONFIG
    ========================= */

    const birdApiKey =
      process.env.BIRD_API_KEY;


    if (!birdApiKey) {

      console.error(
        "BIRD_API_KEY ontbreekt"
      );

      return res.status(500).json({
        ok: false,
        error: "Bird configuratiefout"
      });

    }


    /* =========================
       TELEFOONNUMMER
    ========================= */

    const normalizedPhone =
      normalizePhoneNumber(
        telefoon,
        country
      );


    if (
      !normalizedPhone ||
      !normalizedPhone.startsWith("+")
    ) {

      return res.status(400).json({
        ok: false,
        error: "Ongeldig telefoonnummer"
      });

    }


    /* =========================
       AIRTABLE CONFIG
    ========================= */

    const airtableToken =
      process.env.AIRTABLE_TOKEN;

    const airtableBaseId =
      process.env.AIRTABLE_BASE_ID;

    const airtableTableId =
      process.env.AIRTABLE_TABLE_ID;


    if (
      !airtableToken ||
      !airtableBaseId ||
      !airtableTableId
    ) {

      console.error(
        "Airtable configuratie ontbreekt"
      );

      return res.status(500).json({
        ok: false,
        error: "Airtable configuratiefout"
      });

    }


    const airtableRecordUrl =
      `https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}/${recordId}`;


    /* =========================
       SMS STATUS -> PROCESSING
    ========================= */

    if (!isReceipt) {

if (!isIndicatie) {

  await fetch(
    airtableRecordUrl,
    {
      method: "PATCH",

      headers: {

        "Authorization":
          `Bearer ${airtableToken}`,

        "Content-Type":
          "application/json"

      },

      body:
        JSON.stringify({

          fields: {
            "SMS Status":
              "Processing"
          },

          typecast:
            true

        })
    }
  );

}
}


    /* =========================
       BIRD SENDER
    ========================= */

    const smsSender = "Cardome";


    console.log(
      "Bird SMS request:",
      {
        from:
          smsSender,
        to:
          normalizedPhone,
        recordId:
          recordId
      }
    );


    /* =========================
       BIRD SMS VERSTUREN
    ========================= */

    const birdResponse =
      await fetch(
        "https://eu1.platform.bird.com/v1/sms/messages",
        {
          method: "POST",

          headers: {

            "Authorization":
              `Bearer ${birdApiKey}`,

            "Content-Type":
              "application/json",

"Idempotency-Key":
  isIndicatie
    ? `airtable-${recordId}-indicatie`
    : `airtable-${recordId}-price`
     },

          body:
            JSON.stringify({

              to:
                normalizedPhone,

              from:
                smsSender,

              text:
                message,

              category:
                "transactional",

              metadata: {
                airtable_record_id:
                  recordId
              },

              options: {
                smart_encoding:
                  true
              }

            })
        }
      );


    let birdResult = {};

    try {

      birdResult =
        await birdResponse.json();

    }

    catch(error) {

      birdResult = {
        error:
          "Bird response was geen geldige JSON"
      };

    }


    /* =========================
       BIRD FOUT
    ========================= */

    if (!birdResponse.ok) {

  console.error(
    "Bird SMS fout:",
    birdResult
  );


  if (!isReceipt) {

if (!isIndicatie) {

  await fetch(
    airtableRecordUrl,
    {
      method: "PATCH",

      headers: {
        "Authorization":
          `Bearer ${airtableToken}`,

        "Content-Type":
          "application/json"
      },

      body:
        JSON.stringify({
          fields: {
            "SMS Status":
              "Failed"
          },

          typecast:
            true
        })
    }
  );

}
  }


  return res
    .status(birdResponse.status)
    .json({

      ok: false,

      error:
        birdResult?.error?.message ||
        birdResult?.message ||
        "SMS kon niet worden verstuurd",

      bird:
        birdResult

    });

}


    /* =========================
       SMS GEACCEPTEERD
    ========================= */

    const smsMessageId =
      birdResult.id || "";


if (!isReceipt && !isIndicatie) {

  await fetch(
    airtableRecordUrl,
    {
      method: "PATCH",

      headers: {
        "Authorization":
          `Bearer ${airtableToken}`,

        "Content-Type":
          "application/json"
      },

      body:
        JSON.stringify({
          fields: {

            "SMS Status":
              "Sent",

            "SMS Message ID":
              smsMessageId,

            "SMS Sent At":
              new Date().toISOString()

          },

          typecast:
            true
        })
    }
  );

}


    console.log(
      "SMS geaccepteerd door Bird:",
      {
        recordId:
          recordId,
        telefoon:
          normalizedPhone,
        from:
          smsSender,
        messageId:
          smsMessageId,
        status:
          birdResult.status
      }
    );


    return res.json({

      ok: true,

      status:
        birdResult.status,

      messageId:
        smsMessageId,

      telefoon:
        normalizedPhone,

      from:
        smsSender

    });


  }

  catch(error) {

    console.error(
      "SMS fout:",
      error
    );


    return res.status(500).json({

      ok: false,

      error:
        "Interne serverfout"

    });

  }

});

/* =========================
   VIN SCAN
========================= */

app.post("/api/vin-scan", async (req, res) => {

  try {

    const {
      image
    } = req.body;


    if (!image) {

      return res.status(400).json({
        ok: false,
        error: "Afbeelding ontbreekt"
      });

    }


    const openaiApiKey =
      process.env.OPENAI_API_KEY;


    if (!openaiApiKey) {

      console.error(
        "OPENAI_API_KEY ontbreekt"
      );

      return res.status(500).json({
        ok: false,
        error: "Server configuratiefout"
      });

    }


    const openaiResponse =
      await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",

          headers: {
            "Authorization":
              `Bearer ${openaiApiKey}`,

            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({

              model:
                "gpt-5.4-mini",

              input: [
                {
                  role:
                    "user",

                  content: [
                    {
                      type:
                        "input_text",

                      text:
                        `Read the vehicle VIN from this image.

Return ONLY the VIN.

Rules:
- VIN must contain exactly 17 characters.
- Use uppercase letters and numbers only.
- VIN characters I, O and Q are not valid.
- Do not guess missing characters.
- If a complete valid VIN cannot be read with confidence, return exactly: NOT_FOUND`
                    },

                    {
                      type:
                        "input_image",

                      image_url:
                        image,

                      detail:
                        "high"
                    }
                  ]
                }
              ],

              max_output_tokens:
                50
            })

        }
      );


    const openaiData =
      await openaiResponse.json();


    if (!openaiResponse.ok) {

      console.error(
        "OpenAI VIN fout:",
        openaiData
      );

      return res.status(502).json({
        ok: false,
        error: "VIN kon niet worden uitgelezen"
      });

    }


const outputText =
  (
    openaiData.output || []
  )
    .flatMap(
      item =>
        item.content || []
    )
    .filter(
      part =>
        part.type === "output_text"
    )
    .map(
      part =>
        part.text || ""
    )
    .join(" ")
    .trim();


console.log(
  "OpenAI VIN antwoord:",
  outputText
);


const rawVin =
  String(
    outputText
  )
    .trim()
    .toUpperCase()
    .replace(
      /[^A-Z0-9]/g,
      ""
    );

    const vinRegex =
      /^[A-HJ-NPR-Z0-9]{17}$/;


    if (
      rawVin === "NOTFOUND" ||
      !vinRegex.test(rawVin)
    ) {

      return res.json({
        ok: false,
        found: false
      });

    }


    return res.json({
      ok: true,
      found: true,
      vin: rawVin
    });


  } catch (error) {

    console.error(
      "VIN scan fout:",
      error
    );


    return res.status(500).json({
      ok: false,
      error: "Interne serverfout"
    });

  }

});

/* =========================
   PRIJS CHECK
========================= */

app.post("/api/prijscheck", async (req, res) => {

  try {

const {
  kenteken,
  buitenlands,
  soortschade,
  prijs_via,
  telefoon,
  email,
  merk,
  model,
  bouwjaar,
  vin,
  refbe,
  captchaToken
} = req.body;

    /* =========================
       BASISCONTROLE
    ========================= */

if (
  !kenteken &&
  !buitenlands
) {

  return res.status(400).json({
    ok: false,
    error: "Kenteken ontbreekt"
  });

}

    if (!soortschade) {
      return res.status(400).json({
        ok: false,
        error: "Soort schade ontbreekt"
      });
    }

    if (!prijs_via) {
      return res.status(400).json({
        ok: false,
        error: "Prijs ontvangen via ontbreekt"
      });
    }

    if (!captchaToken) {
      return res.status(400).json({
        ok: false,
        error: "reCAPTCHA ontbreekt"
      });
    }


    /* =========================
       RECAPTCHA CONTROLEREN
    ========================= */

    const recaptchaSecret =
      process.env.RECAPTCHA_SECRET_KEY;

    if (!recaptchaSecret) {

      console.error(
        "RECAPTCHA_SECRET_KEY ontbreekt"
      );

      return res.status(500).json({
        ok: false,
        error: "Server configuratiefout"
      });
    }


    const captchaParams =
      new URLSearchParams();

    captchaParams.append(
      "secret",
      recaptchaSecret
    );

    captchaParams.append(
      "response",
      captchaToken
    );


    const captchaResponse =
      await fetch(
        "https://www.google.com/recaptcha/api/siteverify",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded"
          },

          body:
            captchaParams.toString()
        }
      );


    const captchaResult =
      await captchaResponse.json();


    if (!captchaResult.success) {

      console.log(
        "reCAPTCHA afgekeurd:",
        captchaResult
      );

      return res.status(400).json({
        ok: false,
        error: "reCAPTCHA controle mislukt"
      });
    }


    /* =========================
       VOERTUIGGEGEVENS
    ========================= */

    let finalMerk = "";
    let finalModel = "";
    let finalBouwjaar = "";


    if (buitenlands) {

      finalMerk =
        (merk || "").trim();

      finalModel =
        (model || "").trim();

      finalBouwjaar =
        bouwjaar || "";

    }


    else {

      const rdwKenteken =
        kenteken
          .replace(/[^a-zA-Z0-9]/g, "")
          .toUpperCase();


      try {

        const rdwUrl =
          "https://opendata.rdw.nl/resource/m9d7-ebf2.json" +
          "?$select=merk,handelsbenaming,datum_eerste_toelating" +
          "&kenteken=" +
          encodeURIComponent(rdwKenteken);


        const rdwResponse =
          await fetch(rdwUrl);


        if (!rdwResponse.ok) {

          throw new Error(
            `RDW HTTP ${rdwResponse.status}`
          );

        }


        const rdwData =
          await rdwResponse.json();


        if (rdwData.length > 0) {

          const voertuig =
            rdwData[0];


          finalMerk =
            voertuig.merk || "";


          finalModel =
            voertuig.handelsbenaming || "";


          if (
            voertuig.datum_eerste_toelating
          ) {

            finalBouwjaar =
              voertuig
                .datum_eerste_toelating
                .toString()
                .substring(0, 4);

          }


          console.log(
            "RDW voertuig gevonden:",
            {
              kenteken:
                rdwKenteken,
              merk:
                finalMerk,
              model:
                finalModel,
              bouwjaar:
                finalBouwjaar
            }
          );

        }

        else {

          console.log(
            "RDW kenteken niet gevonden:",
            rdwKenteken
          );

        }

      }

      catch(error) {

        console.error(
          "RDW lookup fout:",
          error
        );

      }

    }


    /* =========================
       AIRTABLE CONFIG
    ========================= */

    const airtableToken =
      process.env.AIRTABLE_TOKEN;

    const airtableBaseId =
      process.env.AIRTABLE_BASE_ID;

    const airtableTableId =
      process.env.AIRTABLE_TABLE_ID;


    if (
      !airtableToken ||
      !airtableBaseId ||
      !airtableTableId
    ) {

      console.error(
        "Airtable configuratie ontbreekt"
      );

      return res.status(500).json({
        ok: false,
        error: "Airtable configuratiefout"
      });
    }


    /* =========================
       AIRTABLE VELDEN
    ========================= */

    const fields = {

      "License plate":
        kenteken,

      "Buitenlands":
        Boolean(buitenlands),

      "Soort schade":
        [soortschade],

      "Prijsopgave via":
        prijs_via

    };

if (refbe) {
  fields["refbe"] = refbe;
}

if (vin) {

  fields["VIN"] =
    String(vin)
      .trim()
      .toUpperCase();

}


    if (telefoon) {

      fields["Phonenumber"] =
        telefoon;

    }


    if (email) {

      fields["Email"] =
        email;

    }


    if (finalMerk) {

      fields["Make"] =
        finalMerk;

    }


    if (finalModel) {

      fields["Model"] =
        finalModel;

    }


    if (finalBouwjaar) {

      fields["Year"] =
        String(finalBouwjaar);

    }


    /* =========================
       AIRTABLE RECORD MAKEN
    ========================= */

    const airtableUrl =
      `https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}`;


    const airtableResponse =
      await fetch(
        airtableUrl,
        {
          method: "POST",

          headers: {

            "Authorization":
              `Bearer ${airtableToken}`,

            "Content-Type":
              "application/json"

          },

          body:
            JSON.stringify({

              fields,

              typecast:
                true

            })
        }
      );


    const airtableResult =
      await airtableResponse.json();


    if (!airtableResponse.ok) {

      console.error(
        "Airtable fout:",
        airtableResult
      );

      return res.status(500).json({

        ok: false,

        error:
          airtableResult?.error?.message ||
          "Airtable record kon niet worden aangemaakt"

      });
    }


    /* =========================
       GELUKT
    ========================= */

    console.log(
      "Airtable record aangemaakt:",
      airtableResult.id
    );


    return res.json({

      ok: true,

      message:
        "Aanvraag opgeslagen",

      recordId:
        airtableResult.id,

      voertuig: {

        merk:
          finalMerk,

        model:
          finalModel,

        bouwjaar:
          finalBouwjaar

      }

    });


  }

  catch(error) {

    console.error(
      "Prijscheck fout:",
      error
    );


    return res.status(500).json({

      ok: false,

      error:
        "Interne serverfout"

    });

  }

});


/* =========================
   START SERVER
========================= */

/* =========================================
   AFSPRAAK - KLANTGEGEVENS OPHALEN
   Voorbeeld:
   GET /api/afspraak/NL30338
========================================= */

app.get(
  "/api/afspraak/:referentie",
  async (req, res) => {

    try {

      const referentie =
        String(
          req.params.referentie || ""
        )
          .trim()
          .toUpperCase();


      /* =========================
         REFERENTIE CONTROLEREN
      ========================= */

      if (
        !/^(NL|BE)[0-9]+$/.test(
          referentie
        )
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Ongeldige referentie"
        });

      }


      /* =========================
         AIRTABLE CONFIG
      ========================= */

      const airtableToken =
        process.env.AIRTABLE_TOKEN;

      const airtableBaseId =
        process.env.AIRTABLE_BASE_ID;

      const airtableTableId =
        process.env.AIRTABLE_TABLE_ID;


      if (
        !airtableToken ||
        !airtableBaseId ||
        !airtableTableId
      ) {

        console.error(
          "Airtable configuratie ontbreekt"
        );

        return res.status(500).json({
          ok: false,
          error:
            "Airtable configuratiefout"
        });

      }


      /* =========================
         RECORD ZOEKEN
      ========================= */

      const formula =
        `{Referentienummer}="${referentie}"`;


      const airtableUrl =
        `https://api.airtable.com/v0/${airtableBaseId}/${airtableTableId}` +
        `?maxRecords=1` +
        `&filterByFormula=${encodeURIComponent(formula)}`;


      const airtableResponse =
        await fetch(
          airtableUrl,
          {
            method: "GET",

            headers: {

              "Authorization":
                `Bearer ${airtableToken}`

            }
          }
        );


      const airtableResult =
        await airtableResponse.json();


      if (!airtableResponse.ok) {

        console.error(
          "Airtable afspraak lookup fout:",
          airtableResult
        );

        return res.status(500).json({
          ok: false,
          error:
            "Klantgegevens konden niet worden opgehaald"
        });

      }


      /* =========================
         NIET GEVONDEN
      ========================= */

      if (
        !airtableResult.records ||
        airtableResult.records.length === 0
      ) {

        return res.status(404).json({
          ok: false,
          error:
            "Referentie niet gevonden"
        });

      }


      /* =========================
         GEGEVENS TERUGGEVEN
      ========================= */

      const record =
        airtableResult.records[0];

      const fields =
        record.fields || {};


      return res.json({

        ok: true,

        referentie,

        telefoon:
          fields["Phonenumber"] || "",

        email:
          fields["Email"] || ""

      });

    } catch (error) {

      console.error(
        "Afspraak lookup fout:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Interne serverfout"
      });

    }

  }
);

/* =====================================================
   CARDOME AFSPRAAK AANVRAGEN (BE / NL, nieuw en bestaand)
   Vervang ALLEEN de oude POST /api/afspraak-aanvragen route.
   De overige endpoints blijven ongewijzigd.
===================================================== */
app.post('/api/afspraak-aanvragen', async (req, res) => {
  try {
    const data = req.body || {};
    const trim = value => String(value ?? '').trim();
    const reference = trim(data.referentie).toUpperCase();
    const country = (reference ? reference.slice(0, 2) : trim(data.land)).toUpperCase();
    const plate = trim(data.kenteken).toUpperCase();
    const damage = trim(data.soortschade);
    const phone = trim(data.telefoon);
    const mail = trim(data.email);
    const location = trim(data.locatie);
    const postalCode = trim(data.postcode);
    const date = trim(data.datum);
    const time = trim(data.tijd);
    const isExisting = Boolean(reference);

    const fail = (error) => res.status(400).json({ok:false,error});
    if (data.heeftReferentie === true && !isExisting) return fail('Referentienummer ontbreekt');
    if (isExisting && !/^(NL|BE)[A-Z0-9-]+$/.test(reference)) return fail('Ongeldige referentie');
    if (!['NL','BE'].includes(country)) return fail('Ongeldig land (NL of BE)');
    if (!isExisting && !plate) return fail('Kenteken ontbreekt');

    const damageValues = [
      'Voorruit','Achterruit','Achterruit deur rechts','Achterruit deur links',
      'Zijruit deur links voor','Zijruit deur rechts voor',
      'Zijruit linksvoor driehoek','Zijruit rechtsvoor driehoek',
      'Zijruit achter links (beweegbaar)','Zijruit achter rechts (beweegbaar)',
      'Zijruit achter links (vaste ruit)','Zijruit achter rechts (vaste ruit)'
    ];
    if (!isExisting && !damageValues.includes(damage)) return fail('Ongeldige of ontbrekende soort schade');
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) return fail('Ongeldig internationaal telefoonnummer');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return fail('Ongeldig of ontbrekend e-mailadres');

    const nlLocations = ['Amsterdam','Rotterdam','Utrecht','Oirschot (Eindhoven)'];
    const beLocations = ['Boomsesteenweg 368, 2610 Antwerpen, België','Mobiele service'];
    const allowedLocations = country === 'NL' ? nlLocations : beLocations;
    if (!allowedLocations.includes(location)) return fail('Ongeldige locatie voor het gekozen land');
    if (location === 'Mobiele service' && !postalCode) return fail('Postcode is verplicht bij mobiele service');

    const allowedTimes = ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00'];
    if (!allowedTimes.includes(time)) return fail('Ongeldige tijd');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Ongeldige datum');

    // Zelfde Europe/Amsterdam -> UTC aanpak als je oorspronkelijke server.js.
      function amsterdamToUtcIso(
        dateString,
        timeString
      ) {

        const [
          year,
          month,
          day
        ] =
          dateString
            .split("-")
            .map(Number);

        const [
          hour,
          minute
        ] =
          timeString
            .split(":")
            .map(Number);


        const wantedUtc =
          Date.UTC(
            year,
            month - 1,
            day,
            hour,
            minute,
            0
          );


        const formatter =
          new Intl.DateTimeFormat(
            "en-CA",
            {
              timeZone:
                "Europe/Amsterdam",

              year:
                "numeric",

              month:
                "2-digit",

              day:
                "2-digit",

              hour:
                "2-digit",

              minute:
                "2-digit",

              second:
                "2-digit",

              hour12:
                false
            }
          );


        function getParts(ms) {

          const parts =
            formatter.formatToParts(
              new Date(ms)
            );

          const result = {};

          for (const part of parts) {

            if (
              part.type !==
              "literal"
            ) {

              result[part.type] =
                Number(part.value);

            }

          }

          return result;

        }


        const first =
          getParts(wantedUtc);


        const firstAsUtc =
          Date.UTC(
            first.year,
            first.month - 1,
            first.day,
            first.hour,
            first.minute,
            first.second
          );


        const firstOffset =
          firstAsUtc -
          wantedUtc;


        let corrected =
          wantedUtc -
          firstOffset;


        const second =
          getParts(corrected);


        const secondAsUtc =
          Date.UTC(
            second.year,
            second.month - 1,
            second.day,
            second.hour,
            second.minute,
            second.second
          );


        const secondOffset =
          secondAsUtc -
          corrected;


        corrected =
          wantedUtc -
          secondOffset;


        return new Date(
          corrected
        ).toISOString();

      }

    let appointmentIso;
    try {
      appointmentIso = amsterdamToUtcIso(date,time);
      // Invalid calendar dates mogen niet stil naar een andere datum doorschuiven.
      const [y,m,d] = date.split('-').map(Number);
      const validCalendarDate = new Date(Date.UTC(y,m-1,d));
      if (validCalendarDate.getUTCFullYear() !== y || validCalendarDate.getUTCMonth() !== m-1 || validCalendarDate.getUTCDate() !== d) {
        return fail('Ongeldige kalenderdatum');
      }
    } catch (error) {
      return fail('Ongeldige datum');
    }
    if (new Date(appointmentIso).getTime() < Date.now() + 48*60*60*1000) {
      return fail('De afspraak moet minimaal 48 uur vooruit liggen');
    }

    const airtableToken = process.env.AIRTABLE_TOKEN;
    const airtableBaseId = process.env.AIRTABLE_BASE_ID;
    if (!airtableToken || !airtableBaseId) {
      console.error('Airtable configuratie ontbreekt');
      return res.status(500).json({ok:false,error:'Airtable configuratiefout'});
    }

    // Exact de kolomnamen die zijn bevestigd voor Afspraakdata.
    // Referentie bewust NIET meesturen voor nieuwe klanten.
    const fields = {
      'Bevestig uw telefoonnummer': phone,
      'Email': mail,
      'Locatie': location,
      'Datum afspraak': appointmentIso
    };
    if (isExisting) fields['Referentie'] = reference;
    if (!isExisting) {
      fields['Kenteken'] = plate;
      // Multiselect: 1 geselecteerde waarde, als Airtable-array.
      fields['Soort schade'] = [damage];
    }
    if (location === 'Mobiele service') fields['Vul uw postcode in'] = postalCode;

    const url = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent('tblRwyg9ypzEzo8Yu')}`;
    const response = await fetch(url, {
      method:'POST',
      headers:{'Authorization':`Bearer ${airtableToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({fields,typecast:true})
    });
    const result = await response.json();
    if (!response.ok) {
      console.error('Airtable afspraak fout:', result);
      return res.status(500).json({ok:false,error:result?.error?.message || 'Afspraak kon niet worden opgeslagen'});
    }
    console.log('Afspraak aangemaakt:',result.id, country, isExisting ? 'bestaande klant' : 'nieuwe klant');
    return res.status(201).json({ok:true,message:'Afspraakaanvraag ontvangen',recordId:result.id});
  } catch (error) {
    console.error('Afspraak aanvragen fout:', error);
    return res.status(500).json({ok:false,error:'Interne serverfout'});
  }
});


/* =====================================
   VIN DECODER - PARTS CATALOGS
===================================== */

app.get(
  "/api/vin-decode",
  async (req, res) => {

    try {

      const vin =
        String(req.query.vin || "")
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "");


      if (
        !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)
      ) {

        return res.status(400).json({
          ok: false,
          error: "Ongeldig VIN"
        });

      }


      const apiKey =
        process.env.PARTS_CATALOGS_API_KEY;

      const userId =
        process.env.PARTS_CATALOGS_USER_ID;


      if (
        !apiKey ||
        !userId
      ) {

        return res.status(500).json({
          ok: false,
          error: "VIN decoder niet geconfigureerd"
        });

      }


      const url =
        "https://www.parts-catalogs.com/api/demo/car/info?q=" +
        encodeURIComponent(vin);


      const response =
        await fetch(
          url,
          {
            method: "GET",

            headers: {
              "Accept":
                "application/json, text/plain, */*",

              "X-Api-Key":
                apiKey,

              "X-Gui-Version":
                "3",

              "X-User-Id":
                userId
            }
          }
        );


      if (!response.ok) {

        console.error(
          "Parts Catalogs HTTP fout:",
          response.status
        );

        return res.status(502).json({
          ok: false,
          error: "Voertuiglookup mislukt"
        });

      }


      const data =
        await response.json();


      const kandidaten =
        Array.isArray(data)
          ? data
          : [data];


      const geldigeKandidaten =
        kandidaten.filter(
          item =>
            item &&
            item.brand &&
            item.modelName
        );


      if (!geldigeKandidaten.length) {

        return res.json({
          ok: true,
          found: false
        });

      }


      /* =====================================
         EUROPA BIJ VOORKEUR
      ===================================== */

      function parameterWaarde(
        item,
        key
      ) {

        const parameter =
          Array.isArray(item.parameters)
            ? item.parameters.find(
                p => p.key === key
              )
            : null;

        return parameter
          ? String(parameter.value || "").trim()
          : "";
      }


      let voertuig =
        geldigeKandidaten.find(
          item =>
            parameterWaarde(
              item,
              "sales_region"
            ).toLowerCase() ===
            "europe"
        );


      if (!voertuig) {

        voertuig =
          geldigeKandidaten[0];

      }


      /* =====================================
         PRODUCTIEPERIODE

         Bijvoorbeeld:
         2002/05 - 2005/11

         Wordt:
         2002/05 -
      ===================================== */

      const productionPeriod =
        parameterWaarde(
          voertuig,
          "prod_period"
        );


      let year = "";


      const productionMatch =
        productionPeriod.match(
          /(\d{4})[\/\-](\d{2})/
        );


      if (productionMatch) {

        year =
          productionMatch[1] +
          "/" +
          productionMatch[2] +
          " -";

      }


      /* =====================================
         FALLBACK NAAR YEAR
      ===================================== */

      if (!year) {

        const echteYear =
          parameterWaarde(
            voertuig,
            "year"
          );


        if (
          echteYear &&
          !echteYear.includes("*")
        ) {

          year =
            echteYear;

        }

      }


      return res.json({

        ok: true,

        found: true,

        vin: vin,

        make:
          String(
            voertuig.brand
          ).trim(),

        model:
          String(
            voertuig.modelName
          ).trim(),

        year:
          year,

        productionPeriod:
          productionPeriod

      });


    } catch (error) {

      console.error(
        "VIN decode fout:",
        error
      );


      return res.status(500).json({
        ok: false,
        error: "VIN decoder fout"
      });

    }

  }
);

/*
|--------------------------------------------------------------------------
| VIN AANVULLEN VIA CARDOME.BE
|--------------------------------------------------------------------------
|
| cardome.be/vin
| -> Railway
| -> Airtable webhook
|
*/

app.post(
  "/api/submit-vin",
  async (req, res) => {

    const vin =
      String(
        req.body.vin || ""
      )
        .trim()
        .toUpperCase()
        .replace(
          /[^A-Z0-9]/g,
          ""
        );


    const referenceNumber =
      String(
        req.body.referenceNumber || ""
      )
        .trim()
        .toUpperCase();


    console.log(
      "VIN aanvulling ontvangen:",
      {
        vin,
        referenceNumber
      }
    );


    if (!referenceNumber) {

      return res.status(400).json({
        success: false,
        error:
          "Geen referentienummer ontvangen"
      });

    }


    if (
      !/^[A-HJ-NPR-Z0-9]{17}$/
        .test(vin)
    ) {

      return res.status(400).json({
        success: false,
        error:
          "Ongeldig VIN-nummer"
      });

    }


    const webhookUrl =
      process.env
        .VIN_AIRTABLE_WEBHOOK_URL;


    if (!webhookUrl) {

      console.error(
        "VIN_AIRTABLE_WEBHOOK_URL ontbreekt"
      );

      return res.status(500).json({
        success: false,
        error:
          "VIN webhook is niet ingesteld"
      });

    }


    try {

      const response =
        await fetch(
          webhookUrl,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                vin,
                referenceNumber
              })
          }
        );


      const text =
        await response.text();


      console.log(
        "VIN Airtable webhook response:",
        response.status,
        text
      );


      if (!response.ok) {

        throw new Error(
          `Airtable webhook fout ${response.status}: ${text}`
        );

      }


      return res.json({
        success: true,
        vin,
        referenceNumber
      });


    } catch (error) {

      console.error(
        "VIN opslaan fout:",
        error.message
      );


      return res.status(500).json({
        success: false,
        error:
          "VIN kon niet worden opgeslagen"
      });

    }

  }
);

app.listen(
  PORT,
  () => {

    console.log(
      `Prijscheck API draait op poort ${PORT}`
    );

  }
);
