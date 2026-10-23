import frCommon from "../../messages/fr/common.json";
import frAsk from "../../messages/fr/ask.json";
import frPlanche from "../../messages/fr/planche.json";
import frTransport from "../../messages/fr/transport.json";
import frScenes from "../../messages/fr/scenes.json";
import frColophon from "../../messages/fr/colophon.json";
import frExplanation from "../../messages/fr/explanation.json";
import frGallery from "../../messages/fr/gallery.json";
import frParams from "../../messages/fr/params.json";
import frReformulate from "../../messages/fr/reformulate.json";
import frQuiz from "../../messages/fr/quiz.json";
import frShare from "../../messages/fr/share.json";
import frDeep from "../../messages/fr/deep.json";
import frExport from "../../messages/fr/export.json";
import enCommon from "../../messages/en/common.json";
import enAsk from "../../messages/en/ask.json";
import enPlanche from "../../messages/en/planche.json";
import enTransport from "../../messages/en/transport.json";
import enScenes from "../../messages/en/scenes.json";
import enColophon from "../../messages/en/colophon.json";
import enExplanation from "../../messages/en/explanation.json";
import enGallery from "../../messages/en/gallery.json";
import enParams from "../../messages/en/params.json";
import enReformulate from "../../messages/en/reformulate.json";
import enQuiz from "../../messages/en/quiz.json";
import enShare from "../../messages/en/share.json";
import enDeep from "../../messages/en/deep.json";
import enExport from "../../messages/en/export.json";

export const messages = {
  fr: {
    ...frCommon,
    ...frAsk,
    ...frPlanche,
    ...frTransport,
    ...frScenes,
    ...frColophon,
    ...frExplanation,
    ...frGallery,
    ...frParams,
    ...frReformulate,
    ...frQuiz,
    ...frShare,
    ...frDeep,
    ...frExport,
  },
  en: {
    ...enCommon,
    ...enAsk,
    ...enPlanche,
    ...enTransport,
    ...enScenes,
    ...enColophon,
    ...enExplanation,
    ...enGallery,
    ...enParams,
    ...enReformulate,
    ...enQuiz,
    ...enShare,
    ...enDeep,
    ...enExport,
  },
} as const;

export type Messages = (typeof messages)["fr"];
