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


    /*
      BUITENLANDS:
      gebruik handmatig ingevulde velden
    */

    if (buitenlands) {

      finalMerk =
        (merk || "").trim();

      finalModel =
        (model || "").trim();

      finalBouwjaar =
        bouwjaar || "";

    }


    /*
      NEDERLANDS:
      opnieuw officieel ophalen via RDW
    */

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
              kenteken: rdwKenteken,
              merk: finalMerk,
              model: finalModel,
              bouwjaar: finalBouwjaar
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

        /*
          RDW-fout mag de aanvraag
          niet blokkeren.
        */

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

      /*
        Airtable Multiple Select
      */
      "Soort schade":
        [soortschade],

      "Prijsopgave via":
        prijs_via

    };


    /* CONTACT */

    if (telefoon) {

      fields["Phonenumber"] =
        telefoon;

    }


    if (email) {

      fields["Email"] =
        email;

    }


    /* =========================
       MERK / MODEL / JAAR
    ========================= */

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
        Number(finalBouwjaar);

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

              typecast: true

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
