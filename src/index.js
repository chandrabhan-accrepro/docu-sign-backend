const express = require("express");
const cors = require("cors");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config();
const docusign = require("docusign-esign");
const bodyParser = require("body-parser");
const fs = require("fs");
const session = require("express-session");
const axios = require("axios");

const port = process.env.PORT || 8000;
const app = express();

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

app.use(
  session({
    secret: "dfsf94835asda",
    resave: true,
    saveUninitialized: true,
  })
);

app.post("/form", async (request, response) => {
  try {
    await checkToken(request);
    let envelopesApi = getEnvelopesApi(request);

    console.log(
      "Enveloper Createion info: ",
      request.body.email,
      request.body.name
    );
    let results = await createEnvelope(
      request.body.email,
      request.body.name,
      request.body.subject,
      request.body.emailBody,
      envelopesApi
    );
    console.log("envelope results ", results);
    // Create the recipient view, the Signing Ceremony
    let viewRequest = makeRecipientViewRequest(
      request.body.name,
      request.body.email
    );
    console.log("EnvelopeID: ", results.envelopeId);
    const envelopeId = results.envelopeId;
    results = await envelopesApi.createRecipientView(
      process.env.ACCOUNT_ID,
      results.envelopeId,
      { recipientViewRequest: viewRequest }
    );

    response.status(200).json({ url: results.url, envelopeId });
  } catch (err) {
    console.log("Error creating", err.message);
  }
});

function getEnvelopesApi(request) {
  let dsApiClient = new docusign.ApiClient();
  dsApiClient.setBasePath(process.env.BASE_PATH);
  dsApiClient.addDefaultHeader(
    "Authorization",
    "Bearer " + request.session.access_token
  );
  return new docusign.EnvelopesApi(dsApiClient);
}

const createEnvelope = async (
  signerEmail,
  signerName,
  subject,
  emailBody,
  envelopesApi
) => {
  try {
    // Read the document file and convert it to base64
    const documentContent = fs.readFileSync(
      path.join(__dirname, "Docu-sign-implementatio.pdf"),
      "base64"
    );

    // console.log("Signer Data", signerEmail, signerName, documentContent);
    // Defined envelope definition with the actual document content
    const envelopeDefinition = {
      emailSubject: subject ? subject : "Please sign this document",
      emailBlurb: emailBody
        ? emailBody
        : "Please review and sign this document attached.",
      status: "sent", // We can also use 'created' to save the envelope as a draft
      documents: [
        {
          documentBase64: documentContent,
          name: "Document.pdf",
          documentId: "1",
        },
      ],
      recipients: {
        signers: [
          {
            email: signerEmail,
            name: signerName,
            recipientId: "1",
            routingOrder: "1",
            tabs: {
              signHereTabs: [
                {
                  anchorString: "SIGN_HERE",
                  anchorUnits: "pixels",
                  anchorXOffset: "0",
                  anchorYOffset: "0",
                },
              ],
            },
          },
        ],
      },
    };

    // Create and send the envelope
    // console.log("Hello world!", process.env.ACCOUNT_ID);
    const results = await envelopesApi.createEnvelope(process.env.ACCOUNT_ID, {
      envelopeDefinition,
    });
    console.log("Results env:", results.envelopeId);
    // Returned envelope status or other relevant data to the frontend
    return { envelopeId: results.envelopeId, status: results.status };
  } catch (error) {
    console.error("Error creating envelope:", error.message);
    return { error: "An error occurred while creating the envelope" };
  }
};

function makeRecipientViewRequest(name, email) {
  let viewRequest = new docusign.RecipientViewRequest();

  viewRequest.returnUrl = "http://localhost:8000/success";
  viewRequest.authenticationMethod = "none";

  // Recipient information must match embedded recipient info
  // we used to create the envelope.
  viewRequest.email = email;
  viewRequest.userName = name;
  viewRequest.clientUserId = process.env.CLIENT_USER_ID;

  return viewRequest;
}

async function checkToken(request) {
  try {
    if (
      request.session.access_token &&
      Date.now() < request.session.expires_at
    ) {
      console.log("re-using access_token ", request.session.access_token);
    } else {
      let dsApiClient = new docusign.ApiClient();
      dsApiClient.setBasePath(process.env.BASE_PATH);
      console.log("generating a new access token: ");
      const results = await dsApiClient.requestJWTUserToken(
        process.env.INTEGRATION_KEY,
        process.env.USER_ID,
        "signature",
        fs.readFileSync(path.join(__dirname, "private.key")),
        3600
      );
      console.log("Result Body data: ", results.body.access_token);
      request.session.access_token = results.body.access_token;
      request.session.expires_at =
        Date.now() + (results.body.expires_in - 60) * 1000;
    }
  } catch (err) {
    console.error("Error: ", err.message);
  }
}

app.post("/getDoc", async (req, res) => {
  try {
    console.log("GET Doc API is Hitted ", req.query.envelopeId);
    const envelopeID = req.query.envelopeId
      ? req.query.envelopeId
      : req.body.envelopeId;
    await checkToken(req);
    let dsApiClient = new docusign.ApiClient();
    dsApiClient.setBasePath(process.env.BASE_PATH);
    dsApiClient.addDefaultHeader(
      "Authorization",
      "Bearer " + req.session.access_token
    );
    let envelopesApi = new docusign.EnvelopesApi(dsApiClient),
      results = null;

    // Call Envelopes::get
    // Exceptions will be caught by the calling function
    results = await envelopesApi.getEnvelope(
      process.env.ACCOUNT_ID,
      envelopeID,
      null
    );

    axios({
      method: "get",
      url: `https://demo.docusign.net/restapi/v2/accounts/${process.env.ACCOUNT_ID}/envelopes/${envelopeID}/documents/1`,
      headers: {
        Authorization: `Bearer ${req.session.access_token}`,
      },
      responseType: "stream",
    })
      .then((docuResponse) => {
        // Check if the response status is 200 (OK)
        if (docuResponse.status === 200) {
          // Define the file path and name
          const filename = `${envelopeID}_${process.env.ACCOUNT_ID}.pdf`;
          const tempFile = path.resolve(__dirname, filename);

          // Pipe the response stream to a file
          docuResponse.data.pipe(fs.createWriteStream(tempFile));

          docuResponse.data.on("end", () => {
            // File has been successfully downloaded
            res.status(200).json({ success: true, data: tempFile });
          });

          docuResponse.data.on("error", (err) => {
            // Error in download
            console.error("Error downloading signed document:", err);
            res.status(500).json({
              success: false,
              error: "Failed to download signed document",
            });
          });
        } else {
          // Handle unexpected status codes (e.g., not 200)
          console.error("Unexpected status code:", docuResponse.status);
          res
            .status(500)
            .json({ success: false, error: "Unexpected status code" });
        }
      })
      .catch((error) => {
        // Handle Axios request errors
        console.error("Axios request error:", error);
        res.status(500).json({ success: false, error: "Axios request error" });
      });
    console.log("Results:", results);
    // console.log("Document Data: ", documentResponse.data);
    // res.status(200).json({ results });
  } catch (err) {
    console.log(err);
    res.status(500).json({ err: err });
  }
});

app.get("/checkstatus", async (req, res) => {
  try {
    const envelopeID = req.query.envelopId;
    await checkToken(req);
    let dsApiClient = new docusign.ApiClient();
    dsApiClient.setBasePath(process.env.BASE_PATH);
    dsApiClient.addDefaultHeader(
      "Authorization",
      "Bearer " + req.session.access_token
    );
    let envelopesApi = new docusign.EnvelopesApi(dsApiClient);
    let results = null;

    // Call Envelopes::get
    // Exceptions will be caught by the calling function
    results = await envelopesApi.getEnvelope(
      process.env.ACCOUNT_ID,
      envelopeID,
      null
    );
    console.log(results);
    res.status(200).json({ results: results });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err });
  }
});

app.get("/", async (request, response) => {
  await checkToken(request);
  response.json({
    success: `Check token successfully returned ${request.session.access_token}`,
  });
});
// https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=cdd45316-d679-47bd-9deb-d8183d635570&redirect_uri=http://localhost:5173/

app.get("/success", (request, response) => {
  response.send("Successfully Completed Signing Process!");
});

app.listen(port, (err) => {
  console.log("successfully listening on port " + port);
});
