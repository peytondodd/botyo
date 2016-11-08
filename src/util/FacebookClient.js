import { dependencies as Inject, singleton as Singleton } from "needlepoint";
import Configuration from "./Configuration";
import * as fs from "fs";
import Promise from "bluebird";
import AsyncResolvable, { ResolvableResult } from "./AsyncResolvable";
import ChatApi from "./ChatApi";

const login = require("facebook-chat-api");

@Singleton
@Inject(Configuration)
export default class FacebookClient extends AsyncResolvable {
    constructor(config) {
        super(ChatApi);

        this.config = config;

        this.appStateFilePath = this.config.get("app.stateFile");
    }

    /**
     * @returns {Promise.<ChatApi>}
     */
    login() {
        return new Promise((resolve, reject) => {
            const loginOptions = this.isAppStateAvailable() ? {
                appState: JSON.parse(fs.readFileSync(this.appStateFilePath, 'utf8'))
            } : {
                email: this.config.get("account.email"),
                password: this.config.get("account.password")
            };

            login(loginOptions, (err, api) => {
                if (err) return reject(err);

                this.api = api;

                fs.writeFileSync(this.appStateFilePath, JSON.stringify(api.getAppState()));

                return resolve(new ChatApi(api));
            });
        });
    }

    /**
     * @returns {Promise}
     */
    logout() {
        return new Promise((resolve, reject) => {
            this.api.logout(err => {
                if (err) return reject(err);

                return resolve();
            });
        })
    }

    /**
     * @returns {boolean}
     */
    isAppStateAvailable() {
        return fs.existsSync(this.appStateFilePath);
    }


    /**
     * @return {Promise.<ChatApi>}
     */
    resolve() {
        return ResolvableResult.of(this.getResolvableType(), this.login());
    }
}