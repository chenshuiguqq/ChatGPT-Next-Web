import { create } from "zustand";
import { persist } from "zustand/middleware";

import { type ChatCompletionResponseMessage } from "openai";
import {
  ControllerPool,
  requestChatStream,
  requestWithPrompt,
} from "../requests";
import { trimTopic } from "../utils";

import Locale from "../locales";
import { showToast } from "../components/ui-lib";
import { ModelType } from "./config";
import { createEmptyMask, Mask } from "./mask";
import { StoreKey } from "../constant";

import { createClient } from "@supabase/supabase-js";
import { supabaseClient } from "../components/embeddings-supabase";

export type Message = ChatCompletionResponseMessage & {
  date: string;
  streaming?: boolean;
  isError?: boolean;
  id?: number;
  model?: ModelType;
};

export function createMessage(override: Partial<Message>): Message {
  return {
    id: Date.now(),
    date: new Date().toLocaleString(),
    role: "user",
    content: "",
    ...override,
  };
}

export const ROLES: Message["role"][] = ["system", "user", "assistant"];

export interface ChatStat {
  tokenCount: number;
  wordCount: number;
  charCount: number;
}

export interface ChatSession {
  id: number;

  topic: string;

  memoryPrompt: string;
  messages: Message[];
  stat: ChatStat;
  lastUpdate: number;
  lastSummarizeIndex: number;

  mask: Mask;
}

export const DEFAULT_TOPIC = Locale.Store.DefaultTopic;
export const BOT_HELLO: Message = createMessage({
  role: "assistant",
  content: Locale.Store.BotHello,
});

function createEmptySession(): ChatSession {
  return {
    id: Date.now() + Math.random(),
    topic: DEFAULT_TOPIC,
    memoryPrompt: "",
    messages: [],
    stat: {
      tokenCount: 0,
      wordCount: 0,
      charCount: 0,
    },
    lastUpdate: Date.now(),
    lastSummarizeIndex: 0,
    mask: createEmptyMask(),
  };
}

interface ChatStore {
  sessions: ChatSession[];
  currentSessionIndex: number;
  globalId: number;
  clearSessions: () => void;
  moveSession: (from: number, to: number) => void;
  selectSession: (index: number) => void;
  newSession: (mask?: Mask) => void;
  deleteSession: (index: number) => void;
  currentSession: () => ChatSession;
  onNewMessage: (message: Message) => void;
  onUserInput: (content: string) => Promise<void>;
  summarizeSession: () => void;
  updateStat: (message: Message) => void;
  updateCurrentSession: (updater: (session: ChatSession) => void) => void;
  updateMessage: (
    sessionIndex: number,
    messageIndex: number,
    updater: (message?: Message) => void,
  ) => void;
  resetSession: () => void;
  getMessagesWithMemory: () => Message[];
  getMemoryPrompt: () => Message;

  clearAllData: () => void;
}

function countMessages(msgs: Message[]) {
  return msgs.reduce((pre, cur) => pre + cur.content.length, 0);
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      sessions: [createEmptySession()],
      currentSessionIndex: 0,
      globalId: 0,

      clearSessions() {
        set(() => ({
          sessions: [createEmptySession()],
          currentSessionIndex: 0,
        }));
      },

      selectSession(index: number) {
        set({
          currentSessionIndex: index,
        });
      },

      moveSession(from: number, to: number) {
        set((state) => {
          const { sessions, currentSessionIndex: oldIndex } = state;

          // move the session
          const newSessions = [...sessions];
          const session = newSessions[from];
          newSessions.splice(from, 1);
          newSessions.splice(to, 0, session);

          // modify current session id
          let newIndex = oldIndex === from ? to : oldIndex;
          if (oldIndex > from && oldIndex <= to) {
            newIndex -= 1;
          } else if (oldIndex < from && oldIndex >= to) {
            newIndex += 1;
          }

          return {
            currentSessionIndex: newIndex,
            sessions: newSessions,
          };
        });
      },

      newSession(mask) {
        const session = createEmptySession();

        set(() => ({ globalId: get().globalId + 1 }));
        session.id = get().globalId;

        if (mask) {
          session.mask = { ...mask };
          session.topic = mask.name;
        }

        set((state) => ({
          currentSessionIndex: 0,
          sessions: [session].concat(state.sessions),
        }));
      },

      deleteSession(index) {
        const deletingLastSession = get().sessions.length === 1;
        const deletedSession = get().sessions.at(index);

        if (!deletedSession) return;

        const sessions = get().sessions.slice();
        sessions.splice(index, 1);

        let nextIndex = Math.min(
          get().currentSessionIndex,
          sessions.length - 1,
        );

        if (deletingLastSession) {
          nextIndex = 0;
          sessions.push(createEmptySession());
        }

        // for undo delete action
        const restoreState = {
          currentSessionIndex: get().currentSessionIndex,
          sessions: get().sessions.slice(),
        };

        set(() => ({
          currentSessionIndex: nextIndex,
          sessions,
        }));

        showToast(
          Locale.Home.DeleteToast,
          {
            text: Locale.Home.Revert,
            onClick() {
              set(() => restoreState);
            },
          },
          5000,
        );
      },

      currentSession() {
        let index = get().currentSessionIndex;
        const sessions = get().sessions;

        if (index < 0 || index >= sessions.length) {
          index = Math.min(sessions.length - 1, Math.max(0, index));
          set(() => ({ currentSessionIndex: index }));
        }

        const session = sessions[index];

        return session;
      },

      onNewMessage(message) {
        get().updateCurrentSession((session) => {
          session.lastUpdate = Date.now();
        });
        get().updateStat(message);
        get().summarizeSession();
      },

      async onUserInput(content) {
        const session = get().currentSession();
        const modelConfig = session.mask.modelConfig;

        const query = "" + content;

        // OpenAI recommends replacing newlines with spaces for best results
        const input = query.replace(/\n/g, " ");
        // console.log("input: ", input);

        const apiKey = "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"; ///process.env.OPENAI_API_KEY;

        const apiURL = "https://api.openai.com"; // process.env.OPENAI_PROXY == "" ? "https://api.openai.com" : process.env.OPENAI_PROXY;

        const embeddingResponse = await fetch(apiURL + "/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input,
            model: "text-embedding-ada-002",
          }),
        });

        const embeddingData = await embeddingResponse.json();
        const [{ embedding }] = embeddingData.data;
        // console.log("embedding: ", embedding);

        const { data: documents, error } = await supabaseClient.rpc(
          "match_simejichat",
          {
            query_embedding: embedding,
            similarity_threshold: 0.78, // Choose an appropriate threshold for your data
            match_count: 2, // Choose the number of matches
          },
        );
        let contextText = "";

        // console.log("documents: ", documents);
        // const len = documents.length;
        // Concat matched documents
        if (documents) {
          for (let i = 0; i < documents.length; i++) {
            const document = documents[i];
            const content = document.content;
            const url = document.url;
            console.log("index: ", i);
            console.log(content);
            console.log(url);
            // Limit context to max 1500 tokens (configurable)
            // if (tokenCount > 1500) {
            //   break;
            // }

            contextText += `${content.trim()}\nSOURCE: ${url}\n---\n`;
          }
        }

        const systemContent = `你充当一个广告运营专员的角色，需要根据客户的问题按照CONTEXT的模板做出回答。当给予“CONTEXT”时，您必须严格按照CONTEXT中运营专员的的模板进行回答，具体aid的前面必须加上“--”，后面必须加上“---”，以及{amount}、{price}占位符，最后再给出一句工作方面的祝福语，并始终以markdown格式输出您的答案。`; //用严肃（输出用"话术1"）和客气（输出用"话术2"）两种态度给出两种回答，
        const systemMessage: Message = createMessage({
          role: "system",
          content: systemContent,
        });

        // content = contextText;
        const userMessage: Message = createMessage({
          role: "user",
          content,
        });

        const botMessage: Message = createMessage({
          role: "assistant",
          streaming: true,
          id: userMessage.id! + 1,
          model: modelConfig.model,
        });

        const message = `
        CONTEXT : ${contextText}
        USER QUESTION: 
        ${query}  
        `;
        userMessage.content = message;
        // const userContextMessage: Message = createMessage({
        //   role: "user",
        //   content: message,
        // });

        // get recent messages
        const recentMessages = get().getMessagesWithMemory();
        const sendMessages = recentMessages.concat(systemMessage);
        const sessionIndex = get().currentSessionIndex;
        const messageIndex = get().currentSession().messages.length + 1;

        // save user's and bot's message
        get().updateCurrentSession((session) => {
          session.messages.push(userMessage);
          session.messages.push(botMessage);
        });

        // make request
        console.log("[User Input] ", sendMessages);
        requestChatStream(sendMessages, {
          onMessage(content, done) {
            let ans_prehandle = "";
            // stream response
            if (done) {
              console.log("done" + content);
              botMessage.streaming = false;
              let output = "";
              for (let i = 0; i < sendMessages.length; i++) {
                const message = sendMessages[i];
                output += message.content + "~~~~~~~~";
                // if (message.role === "assistant") {
                //   ans_prehandle += message.content;
                //   botMessage.content = ans_prehandle;
                //   break;
                // }
              }
              botMessage.content = content;
              ans_prehandle = ans_prehandle + content;
              get().onNewMessage(botMessage);
              ControllerPool.remove(
                sessionIndex,
                botMessage.id ?? messageIndex,
              );

              const query = ans_prehandle;

              // OpenAI recommends replacing newlines with spaces for best results
              let input = query.replace(/\n/g, " ");
              // console.log("input: ", input);
              const regex = /--(.*?)---/g;
              let match_aids: string[] = [];
              let match_aids_origin: string[] = [];
              let match = regex.exec(input);

              // if (match != null) {
              //   return new Response(match[1]);
              // }
              while (match !== null) {
                match_aids_origin.push(match[0]);
                match_aids.push(match[1]);
                console.log(match[1]); // 输出 test
                match = regex.exec(input);
              }

              const no_price_text = "无竞价信息";
              let contextText = no_price_text;
              if (match_aids.length == 0) {
                // botMessage.content = no_price_text;
              } else {
                const func = async () => {
                  const { data: documents, error } = await supabaseClient
                    .from("ad_info")
                    .select("*"); //.eq('aid',match_aids[1]);
                  if (error) console.error(error);

                  if (documents == null) {
                    botMessage.content = "document为空";
                  } else {
                    // console.log("documents: ", documents);
                    // const infos  = documents as Data[];
                    const len = documents.length;

                    // Concat matched documents
                    let aids = "";
                    let has_result = false;
                    if (documents) {
                      for (
                        let m_index = 0;
                        m_index < match_aids.length;
                        m_index++
                      ) {
                        for (let i = 0; i < documents.length; i++) {
                          const document = documents[i];

                          const aid = document.aid as string;
                          const aidStr = match_aids[m_index] as string;
                          const aid_origin = match_aids_origin[
                            m_index
                          ] as string;
                          aids += `${aid}:${aidStr}  \n`;
                          if (aid == aidStr) {
                            // index = m_index;
                            aids += `-----match-----${aid}:${aidStr}  \n`;

                            const amount_from = document.amount_from;
                            const amount_to = document.amount_to;
                            const price = document.price;

                            input = input.replace(aid_origin, aidStr);
                            input = input.replace(
                              "{amount}",
                              `${amount_from}-${amount_to}`,
                            );
                            input = input.replace("{price}", `${price}`);

                            has_result = true;
                          }
                        }
                      }

                      if (has_result) {
                        botMessage.content = input;
                        set(() => ({}));
                        return;
                      }
                    }
                    if (!has_result) {
                      botMessage.content =
                        `这是调试信息：len: ${len}${aids}` +
                        input +
                        "===" +
                        match_aids_origin[0] +
                        "===" +
                        match_aids[0];
                    }
                  }
                };
                func();
              }
              // set(() => ({}));
            } else {
              console.log(content);
              // botMessage.content = content;
              ans_prehandle = ans_prehandle + content;
              // set(() => ({}));
            }
            // ans_prehandle = botMessage.content;
            // console.info("----------------ANSWER: " + ans_prehandle);
            // // if (ans_prehandle.indexOf("--") < 0) {
            //   botMessage.content = ans_prehandle
            // }
            //------------------

            // const response_info = await fetch("./getInfo", {
            //   method: "POST",
            //   headers: {
            //     "Content-Type": "application/json"
            //   },
            //   body: JSON.stringify({
            //     ans_prehandle
            //   })
            // });
            // console.log("Edge function returned.");

            // if (!response_info.ok) {
            //   throw new Error(response_info.statusText);
            // }

            // botMessage.content = contextText;

            // This data is a string
            // const res_info = response_info.body;
            // const info = res_info.;
            // if (res_info == null) {
            //   return;
            // }
          },
          onError(error, statusCode) {
            const isAborted = error.message.includes("aborted");
            if (statusCode === 401) {
              botMessage.content = Locale.Error.Unauthorized;
            } else if (!isAborted) {
              botMessage.content += "\n\n" + Locale.Store.Error;
            }
            botMessage.streaming = false;
            userMessage.isError = !isAborted;
            botMessage.isError = !isAborted;

            set(() => ({}));
            ControllerPool.remove(sessionIndex, botMessage.id ?? messageIndex);
          },
          onController(controller) {
            // collect controller for stop/retry
            ControllerPool.addController(
              sessionIndex,
              botMessage.id ?? messageIndex,
              controller,
            );
          },
          modelConfig: { ...modelConfig },
        });
      },

      getMemoryPrompt() {
        const session = get().currentSession();

        return {
          role: "system",
          content:
            session.memoryPrompt.length > 0
              ? Locale.Store.Prompt.History(session.memoryPrompt)
              : "",
          date: "",
        } as Message;
      },

      getMessagesWithMemory() {
        const session = get().currentSession();
        const modelConfig = session.mask.modelConfig;
        const messages = session.messages.filter((msg) => !msg.isError);
        const n = messages.length;

        const context = session.mask.context.slice();

        // long term memory
        if (
          modelConfig.sendMemory &&
          session.memoryPrompt &&
          session.memoryPrompt.length > 0
        ) {
          const memoryPrompt = get().getMemoryPrompt();
          context.push(memoryPrompt);
        }

        // get short term and unmemoried long term memory
        const shortTermMemoryMessageIndex = Math.max(
          0,
          n - modelConfig.historyMessageCount,
        );
        const longTermMemoryMessageIndex = session.lastSummarizeIndex;
        const oldestIndex = Math.max(
          shortTermMemoryMessageIndex,
          longTermMemoryMessageIndex,
        );
        const threshold = modelConfig.compressMessageLengthThreshold;

        // get recent messages as many as possible
        const reversedRecentMessages = [];
        for (
          let i = n - 1, count = 0;
          i >= oldestIndex && count < threshold;
          i -= 1
        ) {
          const msg = messages[i];
          if (!msg || msg.isError) continue;
          count += msg.content.length;
          reversedRecentMessages.push(msg);
        }

        // concat
        const recentMessages = context.concat(reversedRecentMessages.reverse());

        return recentMessages;
      },

      updateMessage(
        sessionIndex: number,
        messageIndex: number,
        updater: (message?: Message) => void,
      ) {
        const sessions = get().sessions;
        const session = sessions.at(sessionIndex);
        const messages = session?.messages;
        updater(messages?.at(messageIndex));
        set(() => ({ sessions }));
      },

      resetSession() {
        get().updateCurrentSession((session) => {
          session.messages = [];
          session.memoryPrompt = "";
        });
      },

      summarizeSession() {
        const session = get().currentSession();

        // should summarize topic after chating more than 50 words
        const SUMMARIZE_MIN_LEN = 50;
        if (
          session.topic === DEFAULT_TOPIC &&
          countMessages(session.messages) >= SUMMARIZE_MIN_LEN
        ) {
          requestWithPrompt(session.messages, Locale.Store.Prompt.Topic, {
            model: "gpt-3.5-turbo",
          }).then((res) => {
            get().updateCurrentSession(
              (session) =>
                (session.topic = res ? trimTopic(res) : DEFAULT_TOPIC),
            );
          });
        }

        const modelConfig = session.mask.modelConfig;
        let toBeSummarizedMsgs = session.messages.slice(
          session.lastSummarizeIndex,
        );

        const historyMsgLength = countMessages(toBeSummarizedMsgs);

        if (historyMsgLength > modelConfig?.max_tokens ?? 4000) {
          const n = toBeSummarizedMsgs.length;
          toBeSummarizedMsgs = toBeSummarizedMsgs.slice(
            Math.max(0, n - modelConfig.historyMessageCount),
          );
        }

        // add memory prompt
        toBeSummarizedMsgs.unshift(get().getMemoryPrompt());

        const lastSummarizeIndex = session.messages.length;

        console.log(
          "[Chat History] ",
          toBeSummarizedMsgs,
          historyMsgLength,
          modelConfig.compressMessageLengthThreshold,
        );

        if (
          historyMsgLength > modelConfig.compressMessageLengthThreshold &&
          session.mask.modelConfig.sendMemory
        ) {
          requestChatStream(
            toBeSummarizedMsgs.concat({
              role: "system",
              content: Locale.Store.Prompt.Summarize,
              date: "",
            }),
            {
              overrideModel: "gpt-3.5-turbo",
              onMessage(message, done) {
                session.memoryPrompt = message;
                if (done) {
                  console.log("[Memory] ", session.memoryPrompt);
                  session.lastSummarizeIndex = lastSummarizeIndex;
                }
              },
              onError(error) {
                console.error("[Summarize] ", error);
              },
            },
          );
        }
      },

      updateStat(message) {
        get().updateCurrentSession((session) => {
          session.stat.charCount += message.content.length;
          // TODO: should update chat count and word count
        });
      },

      updateCurrentSession(updater) {
        const sessions = get().sessions;
        const index = get().currentSessionIndex;
        updater(sessions[index]);
        set(() => ({ sessions }));
      },

      clearAllData() {
        localStorage.clear();
        location.reload();
      },
    }),
    {
      name: StoreKey.Chat,
      version: 2,
      migrate(persistedState, version) {
        const state = persistedState as any;
        const newState = JSON.parse(JSON.stringify(state)) as ChatStore;

        if (version < 2) {
          newState.globalId = 0;
          newState.sessions = [];

          const oldSessions = state.sessions;
          for (const oldSession of oldSessions) {
            const newSession = createEmptySession();
            newSession.topic = oldSession.topic;
            newSession.messages = [...oldSession.messages];
            newSession.mask.modelConfig.sendMemory = true;
            newSession.mask.modelConfig.historyMessageCount = 4;
            newSession.mask.modelConfig.compressMessageLengthThreshold = 1000;
            newState.sessions.push(newSession);
          }
        }

        return newState;
      },
    },
  ),
);
