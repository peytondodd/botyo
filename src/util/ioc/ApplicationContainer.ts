import { Container, decorate, injectable, interfaces } from "inversify";
import {
    ApplicationConfiguration,
    AsyncResolvable,
    ChatApi,
    ChatThreadUtils,
    Configuration,
    EmptyAsyncResolvable,
    Logger,
    Module,
    ModuleAwareRuntime
} from "botyo-api";
import { LoggerInstance } from "winston";
import LoggingUtils, { LOGGER_NAME } from "../logging/LoggingUtils";
import * as _ from "lodash";
import ModuleRegistry from "./ModuleRegistry";
import ChatThreadUtilsImpl from "../ChatThreadUtilsImpl";
import FilterChain from "../../modules/util/FilterChain";
import TaskScheduler from "../../modules/util/TaskScheduler";
import TypeUtils from "../TypeUtils";
import Newable = interfaces.Newable;
import ServiceIdentifier = interfaces.ServiceIdentifier;

const METADATA_KEYS = require("inversify/lib/constants/metadata_keys");

export default class ApplicationContainer
{
    private constructor(private readonly container: Container) {}

    static create(): ApplicationContainer
    {
        const container = new Container({ autoBindInjectable: true });
        const applicationContainer = new ApplicationContainer(container);

        applicationContainer.decorateApi();
        applicationContainer.bindInternals();

        return applicationContainer;
    }

    public bindApplicationConfiguration(ac: ApplicationConfiguration)
    {
        this.container.bind<ApplicationConfiguration>(ApplicationConfiguration).toConstantValue(ac);
        this.container.bind<ApplicationConfiguration>(ApplicationConfiguration.SYMBOL).toConstantValue(ac);
    }

    public bindToSelfAndGet<M extends Module>(moduleClass: Newable<M>): M
    {
        return this.bindAndGet(moduleClass, moduleClass);
    }

    public bindAndGet<M extends Module>(serviceIdentifier: ServiceIdentifier<M>, moduleClass: Newable<M>): M
    {
        moduleClass.prototype.runtime = new ModuleAwareRuntime(
            moduleClass,
            this.container.get(ChatApi.SYMBOL),
            this.container.get(ApplicationConfiguration.SYMBOL),
            this.container.getTagged(Logger, LOGGER_NAME, moduleClass.name),
            this.container.get(ChatThreadUtils.SYMBOL)
        );

        const theirRootModuleClass = TypeUtils.getPrototypeChain(moduleClass).find(c => c.name === Module.name);
        if (!Reflect.hasOwnMetadata(METADATA_KEYS.PARAM_TYPES, theirRootModuleClass as Function)) {
            decorate(injectable(), theirRootModuleClass);
        }

        this.container.bind<M>(serviceIdentifier).to(moduleClass).inSingletonScope();
        const module = this.container.get(serviceIdentifier);

        this.container.get(ModuleRegistry).register(module);

        return module;
    }

    public async bindAndResolveAsyncResolvable<R>(arClass: Newable<AsyncResolvable<R>>): Promise<void>
    {
        const theirRootAsyncResolvableClass = TypeUtils
            .getPrototypeChain(arClass)
            .find(c => c.name === AsyncResolvable.name);

        if (!Reflect.hasOwnMetadata(METADATA_KEYS.PARAM_TYPES, theirRootAsyncResolvableClass as Function)) {
            decorate(injectable(), theirRootAsyncResolvableClass);
        }

        this.container.bind<AsyncResolvable<R>>(arClass).toSelf().inSingletonScope();

        const resolvable = this.container.get(arClass);
        const result = await resolvable.resolve();

        if (result === undefined ||
            resolvable.getServiceIdentifier() === EmptyAsyncResolvable.EMPTY_IDENTIFIER ||
            TypeUtils.likeInstanceOf(resolvable, EmptyAsyncResolvable)) {
            return;
        }

        this.container.bind(resolvable.getServiceIdentifier()).toConstantValue(result);
    }

    getIoCContainer(): Container
    {
        return this.container;
    }

    private bindInternals()
    {
        this.container.bind<FilterChain>(FilterChain).toSelf().inSingletonScope();
        this.container.bind<TaskScheduler>(TaskScheduler).toSelf().inSingletonScope();

        this.container.bind<ChatThreadUtils>(ChatThreadUtils).to(ChatThreadUtilsImpl).inSingletonScope();
        this.container.bind<ChatThreadUtils>(ChatThreadUtils.SYMBOL).to(ChatThreadUtilsImpl).inSingletonScope();

        this.container.bind<ModuleRegistry>(ModuleRegistry).toSelf().inSingletonScope();

        this.container.bind<LoggerInstance>(Logger).toDynamicValue(ctx => {
            let loggerName;

            const tags = ctx.plan.rootRequest.target.getCustomTags();
            if (tags !== null) {
                const loggerNameTag = tags.find(tag => tag.key === LOGGER_NAME);
                if (loggerNameTag !== undefined) loggerName = loggerNameTag.value;
            }

            // try to guess it from target when injected
            if (loggerName === undefined) {
                const target = ctx.plan.rootRequest.target;
                loggerName = _.get(target, "serviceIdentifier.name") ||
                    _.get(target, "serviceIdentifier.prototype.name");
            }

            return LoggingUtils.createLogger(loggerName);
        }).onActivation((context, injectable) => {
            return injectable;
        });
    }

    private decorateApi()
    {
        decorate(injectable(), AsyncResolvable);
        decorate(injectable(), ChatThreadUtils);
        decorate(injectable(), Configuration);
        decorate(injectable(), Module);
    }
}