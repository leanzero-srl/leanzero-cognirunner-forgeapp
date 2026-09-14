/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GENERATED — DO NOT EDIT.
 *
 * Field-guide pack "voice-rules" — 9 sections.
 *
 * Produced by scripts/bake-knowledge.mjs from the allow-list in knowledge/sources.json.
 * Edit the SOURCE and re-bake; an edit here is overwritten the next time anyone runs the
 * pipeline, and it would not carry the provenance or the leak scan that make this file
 * safe to ship. Dependency-free on purpose: this bundles into the Forge backend and the
 * webpack builds alike.
 *
 * The human-review artefact for this content is knowledge/MANIFEST.md.
 */

export const PACK_ID = "voice-rules";

export const SECTIONS = [
  {
    "id": "voice-rules/voice-rules/adf3f44d/affirmationopeners-and-assistanttalk-6",
    "pack": "voice-rules",
    "title": "affirmationOpeners and assistantTalk",
    "tags": [
      "affirmationopeners",
      "assistanttalk"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "voice-rules",
      "sourceName": "LeanZero voice rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    },
    "bytes": 1951,
    "body": "Affirmation openers are scanned in the first two hundred or so characters so a lead-in cannot smuggle one in; they block. Assistant talk blocks anywhere in the text. Both lists were built by counting a real house corpus: phrases with zero occurrences among genuine colleagues stay blocked, and a phrase the operator himself used was removed rather than blocked, because refusing the person being imitated is the loudest possible false positive.\n\n```json\n{\n  \"affirmationOpeners\": [\n    \"you're right\",\n    \"you are right\",\n    \"you're absolutely right\",\n    \"you're correct\",\n    \"you are correct\",\n    \"spot on\",\n    \"well spotted\",\n    \"you've got it\",\n    \"your read is right\",\n    \"good catch\",\n    \"great catch\",\n    \"nice catch\",\n    \"good point\",\n    \"great point\",\n    \"excellent question\",\n    \"excellent point\",\n    \"that makes sense\",\n    \"that makes perfect sense\",\n    \"great to hear\",\n    \"exactly\",\n    \"precisely\",\n    \"indeed\",\n    \"that confirms it\",\n    \"that explains it\",\n    \"that proves it\",\n    \"that settles it\",\n    \"here's the thing\",\n    \"the short answer is\",\n    \"that's expected\",\n    \"that's working as designed\"\n  ]\n}\n```\n\n```json\n{\n  \"assistantTalk\": [\n    \"i owe you\",\n    \"my apologies\",\n    \"i apologise for\",\n    \"i apologize for\",\n    \"apologies for the confusion\",\n    \"sorry for the confusion\",\n    \"apologise for any inconvenience\",\n    \"apologize for any inconvenience\",\n    \"glad to help\",\n    \"glad to assist\",\n    \"delighted to\",\n    \"here to help\",\n    \"happy to assist\",\n    \"if you have any further questions\",\n    \"if you have any other questions\",\n    \"should you have any questions\",\n    \"kindly check\",\n    \"kindly confirm\",\n    \"kindly note\",\n    \"kindly advise\",\n    \"please be aware\",\n    \"rest assured\",\n    \"i hope this message finds you\",\n    \"i hope this email finds you\",\n    \"please do not hesitate to\",\n    \"please feel free to\",\n    \"for the record\",\n    \"documenting this for\"\n  ]\n}\n```"
  },
  {
    "id": "voice-rules/voice-rules/adf3f44d/blockrules-4",
    "pack": "voice-rules",
    "title": "blockRules",
    "tags": [
      "blockrules"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "voice-rules",
      "sourceName": "LeanZero voice rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    },
    "bytes": 3699,
    "body": "The block tier, common to all five linters: mechanical, unambiguous, would post as garbage or is the loudest tell. A block refuses the post; a false positive is fixed at the rule, never overridden by reflex, because a gate that fires on correct work gets overridden by habit and then never fires. The ids match the linter's block ids so receipts and tests spell them the same way. `compound_shape` promotes warnings: three or more shape warnings stacked in one reply is the shape a model writes, though each alone is ordinary human variance.\n\n```json\n{\n  \"blockRules\": [\n    { \"id\": \"empty\", \"why\": \"nothing to post\" },\n    { \"id\": \"markdown_bullet\", \"why\": \"a bullet list is the first thing a reader notices; people write the items inline or as 1. 2.\" },\n    { \"id\": \"markdown_heading\", \"why\": \"a heading in a comment is a document, not a reply\" },\n    { \"id\": \"markdown_bold\", \"why\": \"bold emphasis in a ticket reads as machine formatting\" },\n    { \"id\": \"markdown_backtick\", \"why\": \"the document format has no markdown; name the identifier in plain text or fence a real code block\" },\n    { \"id\": \"em_dash\", \"why\": \"the em dash, the en dash and a spaced double hyphen are the strongest single lexical tell; a comma or a full stop does the job\" },\n    { \"id\": \"ai_disclaimer\", \"why\": \"the app discloses the model in its UI; the text never does\" },\n    { \"id\": \"banned_opener\", \"why\": \"reflexive agreement or gratitude before the fact is the number-one opener tell\" },\n    { \"id\": \"affirmation_opener\", \"why\": \"telling the reader they are right before answering; lead flat with the bare fact\" },\n    { \"id\": \"verdict_opener\", \"why\": \"a verdict stamp such as that settles it or the short answer is; open on the fix or the concrete cause\" },\n    { \"id\": \"assistant_talk\", \"why\": \"support-desk servility; a colleague does not apologise for inconvenience or say rest assured\" },\n    { \"id\": \"method_leak\", \"why\": \"the outcome is what the reader needs, never the machinery that produced it\" },\n    { \"id\": \"fourth_wall_meta\", \"why\": \"narrating the checking discipline (controls, before-states, what proves nothing) is the agent talking about its apparatus; blocks in every register\" },\n    { \"id\": \"fourth_wall_raw\", \"why\": \"raw tool output such as an endpoint path, a returned boolean or a sandbox tenant; blocks on the public path, an internal note may keep the raw fact\" },\n    { \"id\": \"sign_off\", \"why\": \"a closing formula is a second signature under a persona that is already named\" },\n    { \"id\": \"self_homework\", \"why\": \"process commentary about one's own earlier comment belongs in the ledger, not on somebody else's ticket\" },\n    { \"id\": \"over_max_sentences\", \"why\": \"the register promised a shape and the reply broke it\" },\n    { \"id\": \"long_sentence\", \"why\": \"past the sentence ceiling a sentence is a paragraph with no full stops\" },\n    { \"id\": \"no_short_sentence\", \"why\": \"no sentence at or under the short threshold in a multi-sentence reply is the burstiness tell\" },\n    { \"id\": \"register_word_cap\", \"why\": \"a reply several times longer than its register is a different product\" },\n    { \"id\": \"hard_length\", \"why\": \"past roughly 2500 characters nothing a desk sends is honestly a comment; measured on a real house corpus\" },\n    { \"id\": \"compound_shape\", \"why\": \"three or more structural shape warnings in one reply is the model's shape, whatever the vocabulary\" },\n    { \"id\": \"zero_width_character\", \"why\": \"an invisible character in outward text is a paste artefact or a watermark; either way it goes\" },\n    { \"id\": \"token_integrity\", \"why\": \"a copy-pasteable token (an e-mail, a URL, an issue key, a path) must be letter-perfect, whatever roughness the prose carries\" }\n  ]\n}\n```"
  },
  {
    "id": "voice-rules/voice-rules/adf3f44d/claimwords-and-airegisterwords-8",
    "pack": "voice-rules",
    "title": "claimWords and aiRegisterWords",
    "tags": [
      "claimwords",
      "airegisterwords",
      "route"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "voice-rules",
      "sourceName": "LeanZero voice rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    },
    "bytes": 2544,
    "body": "Claim words are the certainty and absoluteness vocabulary the warn tier flags: each one promises more than a level-2 claim can carry, and each is the shape of a sentence that dies to a single counter-example. AI register words are the lexical tells with a plain replacement; each entry pairs the word with what a person would have written.\n\n```json\n{\n  \"claimWords\": [\n    \"impossible\",\n    \"no way to\",\n    \"cannot be done\",\n    \"there's no native\",\n    \"there is no native\",\n    \"doesn't have a built-in\",\n    \"there is no built-in\",\n    \"definitely\",\n    \"certainly\",\n    \"100%\",\n    \"for sure\",\n    \"guaranteed\",\n    \"the only way\",\n    \"always\",\n    \"never\",\n    \"every time\",\n    \"in all cases\",\n    \"the culprit\",\n    \"the root cause is\",\n    \"this is caused by\",\n    \"that's exactly why\",\n    \"added in version\",\n    \"which is exactly what you're seeing\",\n    \"so it looks like it works\"\n  ]\n}\n```\n\n```json\n{\n  \"aiRegisterWords\": [\n    { \"word\": \"delve\", \"use\": \"look at\" },\n    { \"word\": \"leverage\", \"use\": \"use\" },\n    { \"word\": \"utilize\", \"use\": \"use\" },\n    { \"word\": \"utilise\", \"use\": \"use\" },\n    { \"word\": \"seamless\", \"use\": \"say what is actually absent, such as no restart\" },\n    { \"word\": \"seamlessly\", \"use\": \"say what is actually absent\" },\n    { \"word\": \"robust\", \"use\": \"say what it survives\" },\n    { \"word\": \"holistic\", \"use\": \"whole\" },\n    { \"word\": \"synergy\", \"use\": \"drop it\" },\n    { \"word\": \"boasts\", \"use\": \"has\" },\n    { \"word\": \"effortlessly\", \"use\": \"drop it\" },\n    { \"word\": \"plethora\", \"use\": \"many\" },\n    { \"word\": \"a myriad of\", \"use\": \"many\" },\n    { \"word\": \"tapestry\", \"use\": \"drop it\" },\n    { \"word\": \"elevate your\", \"use\": \"improve\" },\n    { \"word\": \"underscores the importance\", \"use\": \"matters because\" },\n    { \"word\": \"plays a pivotal role\", \"use\": \"is needed for\" },\n    { \"word\": \"stands as a testament\", \"use\": \"shows\" },\n    { \"word\": \"in order to\", \"use\": \"to\" },\n    { \"word\": \"when it comes to\", \"use\": \"for\" },\n    { \"word\": \"at the end of the day\", \"use\": \"drop it\" },\n    { \"word\": \"in today's\", \"use\": \"drop it\" },\n    { \"word\": \"it's worth noting\", \"use\": \"drop it\" },\n    { \"word\": \"keep in mind\", \"use\": \"drop it\" },\n    { \"word\": \"essentially\", \"use\": \"drop it\" },\n    { \"word\": \"basically\", \"use\": \"drop it\" },\n    { \"word\": \"high-leverage\", \"use\": \"useful\" },\n    { \"word\": \"the pragmatic move\", \"use\": \"the fix\" },\n    { \"word\": \"the sensible route\", \"use\": \"the fix\" },\n    { \"word\": \"circling back\", \"use\": \"drop it\" },\n    { \"word\": \"to recap\", \"use\": \"drop it\" }\n  ]\n}\n```"
  },
  {
    "id": "voice-rules/voice-rules/adf3f44d/methodleaks-2",
    "pack": "voice-rules",
    "title": "methodLeaks",
    "tags": [
      "methodleaks",
      "api"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "voice-rules",
      "sourceName": "LeanZero voice rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    },
    "bytes": 2086,
    "body": "The agent describing its own machinery to someone who did not ask. A colleague says what is true about the ticket, not how they found out, and these phrases also leak the app's internals into a customer-visible comment, which is why the class is a hard block rather than a warning.\n\n```json\n{\n  \"methodLeaks\": [\n    \"i ran a query\",\n    \"i ran a search\",\n    \"i queried\",\n    \"via the api\",\n    \"through the api\",\n    \"using the api\",\n    \"the rest api\",\n    \"i searched jira\",\n    \"my search returned\",\n    \"based on my analysis\",\n    \"based on the data i\",\n    \"according to my records\",\n    \"i was unable to retrieve\",\n    \"i do not have access to\",\n    \"i don't have access to\",\n    \"my training data\",\n    \"in my context\",\n    \"the system prompt\",\n    \"as per my instructions\",\n    \"i have been instructed\"\n  ]\n}\n```\n\n## signOffs\nThe Virtual Administrator writes as the app user with the persona name already in the text, so a letter-style closing is both the wrong register and a second signature. Matched at the end of the text or on a line of its own.\n\n```json\n{\n  \"signOffs\": [\n    \"best regards\",\n    \"kind regards\",\n    \"warm regards\",\n    \"regards\",\n    \"sincerely\",\n    \"yours sincerely\",\n    \"yours faithfully\",\n    \"cheers\",\n    \"best wishes\",\n    \"all the best\",\n    \"thanks in advance\",\n    \"looking forward to hearing from you\",\n    \"please don't hesitate to reach out\",\n    \"please do not hesitate to contact us\",\n    \"let me know if you need anything else\",\n    \"feel free to reach out\"\n  ]\n}\n```\n\n## aiDisclaimers\nThe one class never acceptable anywhere in the text, in any register, at any length: it tells the reader the answer came from a model, which is the app's decision to disclose in the UI, not the agent's to blurt mid-sentence.\n\n```json\n{\n  \"aiDisclaimers\": [\n    \"as an ai\",\n    \"as a language model\",\n    \"as an assistant\",\n    \"i'm just an ai\",\n    \"i am just an ai\",\n    \"i'm an ai\",\n    \"i am an ai\",\n    \"i am a bot\",\n    \"i'm a bot\",\n    \"automated response\",\n    \"this is an automated message\",\n    \"generated by ai\",\n    \"ai-generated\"\n  ]\n}\n```"
  },
  {
    "id": "voice-rules/voice-rules/adf3f44d/methodleakverbs-and-hedgewords-7",
    "pack": "voice-rules",
    "title": "methodLeakVerbs and hedgeWords",
    "tags": [
      "methodleakverbs",
      "hedgewords",
      "api"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "voice-rules",
      "sourceName": "LeanZero voice rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    },
    "bytes": 2539,
    "body": "Method-leak verbs extend the phrase table with the verb shapes the desk linters block: a tool, script, query or endpoint as the grammatical subject of a reporting verb, a returned boolean, an HTTP verb followed by a path, a sandbox or staging tenant, or the admin seat as the vantage point. Hedge words are the confidence-bookkeeping vocabulary that leaks the ladder into the ticket: the reader is owed the claim at the level reached, not the bookkeeping that reached it.\n\n```json\n{\n  \"methodLeakVerbs\": [\n    \"the script says\",\n    \"the script reports\",\n    \"the script returned\",\n    \"the tool says\",\n    \"the tool shows\",\n    \"the query returns\",\n    \"the query returned\",\n    \"the endpoint returns\",\n    \"the endpoint returned\",\n    \"the api call returned\",\n    \"the api says\",\n    \"the api confirms\",\n    \"according to the api\",\n    \"according to the endpoint\",\n    \"according to the script\",\n    \"returns true\",\n    \"returns false\",\n    \"returned true\",\n    \"returned false\",\n    \"came back true\",\n    \"came back false\",\n    \"came back clean\",\n    \"i ran a script\",\n    \"i automated\",\n    \"in my sandbox\",\n    \"in the sandbox\",\n    \"on the sandbox\",\n    \"sandbox tenant\",\n    \"staging tenant\",\n    \"from the admin seat\",\n    \"measured from the admin seat\",\n    \"from my admin account\",\n    \"over the endpoint\",\n    \"through the endpoint\",\n    \"on the permission check\",\n    \"the access check returns\"\n  ]\n}\n```\n\n```json\n{\n  \"hedgeWords\": [\n    \"is untested\",\n    \"spot-checked\",\n    \"spot checked\",\n    \"spot-check\",\n    \"i re-checked\",\n    \"i have re-checked\",\n    \"tested and confirmed\",\n    \"checked and confirmed\",\n    \"verified and confirmed\",\n    \"proves nothing\",\n    \"does not prove\",\n    \"doesn't prove\",\n    \"the before-state is saved\",\n    \"the before state is kept\",\n    \"i kept a record\",\n    \"i kept a note\",\n    \"the same as when i checked\",\n    \"so it doesn't have to be measured again\",\n    \"so it does not have to be checked again\",\n    \"population i can measure\",\n    \"i cannot measure\",\n    \"i can't measure\",\n    \"measured again\",\n    \"measured population\",\n    \"a positive control\",\n    \"a negative control\",\n    \"an invented account\",\n    \"a nonsense id\",\n    \"not silently empty\",\n    \"so the search is live\",\n    \"my search didn't find\",\n    \"the search does not find\",\n    \"returns 0 on the same endpoint\",\n    \"correcting myself\",\n    \"i should not have written\",\n    \"i shouldn't have said\",\n    \"my comment above was\",\n    \"my note above is\",\n    \"i hadn't opened them\",\n    \"i had not read it\"\n  ]\n}\n```"
  },
  {
    "id": "voice-rules/voice-rules/adf3f44d/registerwordcaps-and-defaultregister-3",
    "pack": "voice-rules",
    "title": "registerWordCaps and defaultRegister",
    "tags": [
      "registerwordcaps",
      "defaultregister"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "voice-rules",
      "sourceName": "LeanZero voice rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    },
    "bytes": 1300,
    "body": "Total words a message may spend, per register. These are not style advice: a reply four times longer than the register promises is a different product, and the point of a register is that the reader can predict the shape of what arrives. Terse is the answer and nothing else; plain is the answer plus what it depends on; warm is the answer, its context and one sentence of acknowledgement. The default register is the middle one, never the widest.\n\n```json\n{\n  \"registerWordCaps\": { \"terse\": 45, \"plain\": 80, \"warm\": 120 }\n}\n```\n\n```json\n{\n  \"defaultRegister\": \"plain\"\n}\n```\n\n## Structural numbers\n`maxSentenceWords` is a readability ceiling: past 45 words a sentence in a ticket is a paragraph with no full stops. The burstiness pair encodes the one measurable difference between human and generated prose in short messages: people mix a long sentence with a short one, generators emit three medium ones. A message of at least `burstinessMinSentences` sentences must contain one of `burstinessShortWords` words or fewer. The two warn thresholds are recorded on the item, never blocking.\n\n```json\n{\n  \"maxSentenceWords\": 45\n}\n```\n\n```json\n{\n  \"burstinessShortWords\": 8\n}\n```\n\n```json\n{\n  \"burstinessMinSentences\": 3\n}\n```\n\n```json\n{\n  \"warnExclamations\": 1\n}\n```\n\n```json\n{\n  \"warnQuestions\": 2\n}\n```"
  },
  {
    "id": "voice-rules/voice-rules/adf3f44d/shapethresholds-9",
    "pack": "voice-rules",
    "title": "shapeThresholds",
    "tags": [
      "shapethresholds"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "voice-rules",
      "sourceName": "LeanZero voice rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    },
    "bytes": 1774,
    "body": "The structural numbers behind the shape warnings, as measured on real house corpora. They are calibrated per room and the numbers here are the defaults for a room that has not been measured: the sentence-length coefficient-of-variation floor of 0.35 reproduces a roughly thirty percent signal rate on a corpus whose human median was 0.44; the paragraph-weight floor of 0.22 applies only from four paragraphs with a mean of at least fifteen words; the bigram repeat count of four is where a phrase becomes a tic; the antithesis count of two is where an X-not-Y shape stops being human; the compound block fires at three stacked shape warnings. The house-length numbers come from a corpus with a median of 18 words, a 90th percentile of 75, a 95th of 114 and a 99th of 258; 900 characters is where a reply has left the archetype and 2500 is where nothing sent is honestly a comment. Port the method, not the number: re-measure on the room being written into and tune each number with the measurement that justified it, one rule per pass.\n\n```json\n{\n  \"shapeThresholds\": {\n    \"sentenceLengthCvWarn\": 0.35,\n    \"sentenceLengthCvHumanMedian\": 0.44,\n    \"sentenceLengthCvMinMeanWords\": 8,\n    \"paragraphWeightCvWarn\": 0.22,\n    \"paragraphWeightMinParagraphs\": 4,\n    \"paragraphWeightMinMeanWords\": 15,\n    \"noContractionsMinSentences\": 3,\n    \"noContractionsMinWords\": 60,\n    \"bigramRepeatWarn\": 4,\n    \"antithesisWarnCount\": 2,\n    \"compoundShapeBlockCount\": 3,\n    \"houseWordsMedian\": 18,\n    \"houseWordsP90\": 75,\n    \"houseWordsP95\": 114,\n    \"houseWordsP99\": 258,\n    \"warnCharsOverArchetype\": 900,\n    \"blockCharsHard\": 2500,\n    \"affirmationScanChars\": 220,\n    \"paragraphBandWarnFraction\": 0.35,\n    \"paragraphBandLowWords\": 40,\n    \"paragraphBandHighWords\": 79\n  }\n}\n```"
  },
  {
    "id": "voice-rules/voice-rules/adf3f44d/voice-rules-1",
    "pack": "voice-rules",
    "title": "Voice rules",
    "tags": [
      "voice",
      "rules"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "voice-rules",
      "sourceName": "LeanZero voice rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    },
    "bytes": 2066,
    "body": "<!--\n CogniRunner - AI-powered workflow validation for Jira\n Copyright (C) 2025 LeanZero\n SPDX-License-Identifier: Apache-2.0\n\n Tier D replacement. THIS PACK IS DATA, NOT PROSE FOR A MODEL. Every section carries one\n fenced JSON object whose single top-level key is a table name; the eleven names that\n src/shared/voice-lint.js already reads (bannedOpeners, methodLeaks, signOffs,\n aiDisclaimers, registerWordCaps, defaultRegister, maxSentenceWords, burstinessShortWords,\n burstinessMinSentences, warnExclamations, warnQuestions) are IDENTICAL in name and value\n to src/shared/voice-rules-data.js, so the lint can switch its source to this pack without\n touching a rule. The remaining tables (blockRules, warnRules, affirmationOpeners,\n assistantTalk, methodLeakVerbs, hedgeWords, claimWords, aiRegisterWords, shapeThresholds)\n are the generic tiers shared by five independently calibrated outward-text linters,\n re-stated here as word lists. No regular expression, quoted corpus line, person, desk\n or client name travels with a table. Everything is lower-case; the linter matches\n case-insensitively.\n-->\n\n# Voice rules\n\n## bannedOpeners\nOpeners that announce a machine. A person answering a ticket starts with the answer, a fact or a question; these are conversational filler an assistant emits to be agreeable. The linter matches them only at the start of the first sentence, so the same words mid-text are fine. This table is byte-for-byte the one the linter ships today; the wider affirmation and assistant-talk tables further down are additions from the desk linters and are not yet wired.\n\n```json\n{\n  \"bannedOpeners\": [\n    \"great question\",\n    \"good question\",\n    \"certainly\",\n    \"absolutely\",\n    \"of course\",\n    \"sure thing\",\n    \"i understand\",\n    \"i'd be happy to\",\n    \"i would be happy to\",\n    \"happy to help\",\n    \"thanks for reaching out\",\n    \"thank you for reaching out\",\n    \"thanks for your patience\",\n    \"thank you for your patience\",\n    \"let me help you\",\n    \"i hope this helps\",\n    \"as requested\",\n    \"no problem at all\"\n  ]\n}\n```"
  },
  {
    "id": "voice-rules/voice-rules/adf3f44d/warnrules-5",
    "pack": "voice-rules",
    "title": "warnRules",
    "tags": [
      "warnrules",
      "http-404",
      "route"
    ],
    "audience": [
      "codegen",
      "coder",
      "agent",
      "va",
      "review"
    ],
    "provenance": {
      "source": "voice-rules",
      "sourceName": "LeanZero voice rules",
      "path": "knowledge/authored/voice-rules.md",
      "hash": "a8baf7ec6b97a0bf",
      "licence": "ours (re-authored)"
    },
    "bytes": 3964,
    "body": "The warn tier needs judgment: it prints, it never stops a post, and it is advisory input to the gate. Thresholds are set where they earn their keep, not at the ideal, because a warning that always fires gets ignored, and that is how one desk's own antithesis warning died. A rule's numbers are calibrated on the house corpus of the room being written into, never on the agent's own output; the same constant ported to a different room fired on half of the genuine human comments there, which is warn fatigue by definition.\n\n```json\n{\n  \"warnRules\": [\n    { \"id\": \"exclamations\", \"why\": \"more than one exclamation mark is enthusiasm nobody asked for\" },\n    { \"id\": \"question_pile\", \"why\": \"more than two questions is an interview, not an answer\" },\n    { \"id\": \"emoji\", \"why\": \"recorded, not blocked; most rooms do not use them\" },\n    { \"id\": \"repeated_sentence_opener\", \"why\": \"sentences starting the same way is the column-of-blocks shape\" },\n    { \"id\": \"absolute_impossibility\", \"why\": \"you have not seen every configuration\" },\n    { \"id\": \"negative_capability\", \"why\": \"a negative cannot be proven from a document\" },\n    { \"id\": \"certainty_word\", \"why\": \"definitely, certainly, guaranteed promise more than a level-2 claim carries\" },\n    { \"id\": \"only_way\", \"why\": \"there is almost always another way\" },\n    { \"id\": \"absolute_frequency\", \"why\": \"always, never, every time die to one counter-example\" },\n    { \"id\": \"just_simply\", \"why\": \"just do X belittles the reader's problem\" },\n    { \"id\": \"causal_stamp\", \"why\": \"the culprit, the root cause is: a diagnosis asserted as a verdict\" },\n    { \"id\": \"version_claim\", \"why\": \"a version number is a claim the confidence level cannot see\" },\n    { \"id\": \"filler_phrase\", \"why\": \"it is worth noting, keep in mind, essentially, basically\" },\n    { \"id\": \"mechanism_preamble\", \"why\": \"front-loading the principle; lead with the fix or the cause\" },\n    { \"id\": \"counted_options\", \"why\": \"two ways, three reasons: a listicle skeleton\" },\n    { \"id\": \"ranked_option\", \"why\": \"the cleaner option, the pragmatic route rank unasked\" },\n    { \"id\": \"alternative_offer\", \"why\": \"if you would rather, alternatively: a menu instead of an answer\" },\n    { \"id\": \"easiest_fix\", \"why\": \"the easiest fix is: confidence theatre\" },\n    { \"id\": \"recap_marker\", \"why\": \"to recap, circling back, by the way: scaffolding\" },\n    { \"id\": \"confirmation_echo\", \"why\": \"which is exactly what you are seeing echoes the report as evidence\" },\n    { \"id\": \"good_luck\", \"why\": \"good luck, happy to dig: sign-off adjacent\" },\n    { \"id\": \"leverage_register\", \"why\": \"high-leverage, the pragmatic move: consultant-speak\" },\n    { \"id\": \"lives_in\", \"why\": \"lives in, sits under, resides at; a person says it is in\" },\n    { \"id\": \"one_catch\", \"why\": \"one catch, honest caveats announce a caveat instead of stating it\" },\n    { \"id\": \"ai_register_word\", \"why\": \"a word from the aiRegisterWords table\" },\n    { \"id\": \"antithesis\", \"why\": \"X, not Y or rather than more than once; once is human\" },\n    { \"id\": \"repeated_phrase\", \"why\": \"a bigram used four or more times reads like variable substitution\" },\n    { \"id\": \"metronomic_rhythm\", \"why\": \"sentence-length variation under the house floor is the strongest mechanical tell\" },\n    { \"id\": \"no_contractions\", \"why\": \"a multi-sentence reply with no contraction; calibrated per room\" },\n    { \"id\": \"uniform_paragraph_weight\", \"why\": \"real answers are lumpy: one long paragraph, one single line\" },\n    { \"id\": \"unfenced_code\", \"why\": \"code-shaped lines pasted as prose will not survive the document format\" },\n    { \"id\": \"over_house_length\", \"why\": \"past the house 90th percentile you have left the archetype\" },\n    { \"id\": \"negative_without_control\", \"why\": \"a 404 or empty result cited as evidence with no control; an agent tic, three of 885 human comments\" },\n    { \"id\": \"over_polish\", \"why\": \"a flawless draft is a tell when the room's real comments carry rough edges\" }\n  ]\n}\n```"
  }
];

export default SECTIONS;
