import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

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
      message
    } = req.body;


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


    /* =========================
       BIRD SENDER
    ========================= */

    const smsSender =
      "+3197058019610";


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
              `airtable-${recordId}`

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
      captchaToken
    } = req.body;


    /* =========================
       BASISCONTROLE
    ========================= */

    if (!kenteken) {
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

app.listen(
  PORT,
  () => {

    console.log(
      `Prijscheck API draait op poort ${PORT}`
    );

  }
);
